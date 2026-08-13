/**
 * 商家扫码点餐订单查询响应映射（纯函数，无 NestJS 依赖）。
 *
 * 数据库订单金额统一以「分」存储；商家端查询接口统一以「元」输出。
 * 计算器/格式化器由调用方注入，保证映射层无副作用、可独立测试。
 */
import type { ScanOrderStatus } from '@prisma/client';
import {
  fenToYuan,
  pointsDeductAmountFen,
  toDiscountItems,
} from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';
import type { ScanOrderingPriceInput } from './scan-ordering-pricing.service';
import type {
  ScanOrderingAmountSummary,
  ScanOrderingOrderAmountSummary,
  ScanOrderingOrderDetailPayload,
  ScanOrderingOrderItemSummary,
  ScanOrderingOrderListItem,
} from './scan-ordering.types';

/** 金额汇总计算函数类型（注入 ScanOrderingPricingService.calculateSummary）。 */
export type AmountSummaryCalculator = (
  input: ScanOrderingPriceInput,
) => ScanOrderingAmountSummary;

/** 取餐号格式化函数类型（注入 ScanOrderingPickupNumberService.formatPickupNumber）。 */
export type PickupNumberFormatter = (
  pickupNumber: number | null | undefined,
) => string | null;

/** 金额汇总所需的最小订单字段集合（金额均为分）。 */
export interface ScanOrderingAmountSummarySource {
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  taxAmount: number;
  serviceFeeAmount: number;
  paidAmount: number;
  payableAmount: number;
  marketingSnapshot: unknown;
}

/** 订单列表查询 select 返回的记录形态。 */
export interface ScanOrderListItemSource extends ScanOrderingAmountSummarySource {
  id: number;
  orderNo: string;
  version: number;
  status: ScanOrderStatus;
  createdAt: Date;
  clubUserId: number | null;
  diningRoundId: string;
  remark: string | null;
  table: { name: string };
  items: Array<{
    productNameSnapshot: string;
    productImageUrlSnapshot: string | null;
    quantity: number;
    unitPriceAmount: number;
    lineTotalAmount: number;
    payableLineAmount: number;
    specs: Array<{ specOptionNameSnapshot: string }>;
  }>;
  pickupNumber: number | null;
  pickupNumberStatus: ScanOrderingOrderListItem['pickupNumberStatus'];
  pickupCalledAt: Date | null;
}

/** 订单详情查询 include 返回的记录形态。 */
export interface ScanOrderDetailSource extends ScanOrderingAmountSummarySource {
  id: number;
  orderNo: string;
  version: number;
  status: ScanOrderStatus;
  createdAt: Date;
  pickupNumber: number | null;
  table: { name: string; tableCode: string };
  items: Array<{
    productNameSnapshot: string;
    quantity: number;
    lineTotalAmount: number;
    payableLineAmount: number;
    specs: Array<{
      specOptionNameSnapshot: string;
      extraPriceSnapshot: number;
    }>;
  }>;
  histories: Array<{
    fromStatus: string;
    toStatus: string;
    reason: string | null;
    createdAt: Date;
  }>;
}

/**
 * 组装订单金额汇总输出（元）。
 *
 * 以数据库落库的 payableAmount 为权威值（含会员等级折扣 + 积分抵扣），
 * 避免 calculateSummary 漏算会员折扣（productDiscountAmount 当前已含会员折扣）
 * 或未感知积分抵扣的差异；outstandingAmount 同步按真实应付重算。
 */
export const toAmountSummary = (
  order: ScanOrderingAmountSummarySource,
  calculateSummary: AmountSummaryCalculator,
): ScanOrderingOrderAmountSummary => {
  const realPayableFen = order.payableAmount ?? 0;
  const realPaidFen = order.paidAmount ?? 0;
  return {
    ...calculateSummary({
      itemOriginalAmountCents: order.itemOriginalAmount,
      specificationExtraAmountCents: order.specificationExtraAmount,
      productDiscountAmountCents: order.productDiscountAmount,
      orderDiscountAmountCents: order.orderDiscountAmount,
      taxAmountCents: order.taxAmount,
      serviceFeeAmountCents: order.serviceFeeAmount,
      paidAmountCents: order.paidAmount,
    }),
    payableAmount: fenToYuan(realPayableFen),
    outstandingAmount: fenToYuan(Math.max(realPayableFen - realPaidFen, 0)),
    // 积分抵扣金额与优惠清单：由后端从营销快照组装，前端只读展示
    pointsDeductAmount: fenToYuan(
      pointsDeductAmountFen(order.marketingSnapshot),
    ),
    discountItems: toDiscountItems(order.marketingSnapshot),
  };
};

/**
 * 组装订单商品摘要列表：每条 ScanOrderItem 已带完整的(商品+规格)快照，
 * 以 1:1 方式输出，前端可在卡片里独立渲染图片、规格、数量、金额。
 */
export const toItemSummaries = (
  items: ScanOrderListItemSource['items'],
): ScanOrderingOrderItemSummary[] =>
  items.map((item) => ({
    productName: item.productNameSnapshot,
    productImageUrl: item.productImageUrlSnapshot ?? null,
    quantity: item.quantity,
    specs: (item.specs ?? []).map((spec) => spec.specOptionNameSnapshot),
    unitPrice: fenToYuan(item.unitPriceAmount ?? 0),
    lineTotalAmount: fenToYuan(item.lineTotalAmount ?? 0),
    payableLineAmount: fenToYuan(item.payableLineAmount ?? 0),
  }));

/**
 * 兼容旧前端消费的简洁文本摘要: 仅展示「商品名×数量」,不再嵌入
 * 括号规格列表,完整规格清单统一通过 items 数组下发。
 */
export const toItemSummaryText = (
  itemSummaries: ScanOrderingOrderItemSummary[],
): string =>
  itemSummaries
    .map((item) => `${item.productName}×${item.quantity}`)
    .join('、');

/** 组装商家订单列表项。 */
export const toOrderListItem = (input: {
  order: ScanOrderListItemSource;
  guestName: string;
  sessionOrderSequence: number;
  calculateSummary: AmountSummaryCalculator;
  formatPickupNumber: PickupNumberFormatter;
}): ScanOrderingOrderListItem => {
  const {
    order,
    guestName,
    sessionOrderSequence,
    calculateSummary,
    formatPickupNumber,
  } = input;
  const itemSummaries = toItemSummaries(order.items);
  return {
    id: order.id,
    orderNo: order.orderNo,
    version: order.version,
    itemSummary: toItemSummaryText(itemSummaries),
    items: itemSummaries,
    remark: order.remark,
    tableName: order.table.name,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    amountSummary: toAmountSummary(order, calculateSummary),
    guestName,
    // 字段名沿用 sessionOrderSequence 以兼容前端；语义为同一 diningRound 内的累计序号，>1 即视为加餐
    sessionOrderSequence,
    pickupNumber: order.pickupNumber,
    pickupNumberLabel: formatPickupNumber(order.pickupNumber),
    pickupNumberStatus: order.pickupNumberStatus,
    pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
    // 兼容旧前端: 仍以首个有图片的商品作为卡片缩略图;卡片层应改用 items 数组渲染多张缩略图
    imageUrl:
      order.items.find((item) => item.productImageUrlSnapshot)
        ?.productImageUrlSnapshot ?? null,
  };
};

/** 组装订单详情商品行：原价取未扣优惠的 lineTotalAmount，应付取已扣优惠的 payableLineAmount。 */
export const toDetailItem = (
  item: ScanOrderDetailSource['items'][number],
  calculateSummary: AmountSummaryCalculator,
): ScanOrderingOrderDetailPayload['items'][number] => ({
  name: item.productNameSnapshot,
  quantity: item.quantity,
  // 单项原价小计（元,未扣商品级优惠），用于详情卡右侧展示"原价"
  lineTotalAmount: fenToYuan(item.lineTotalAmount ?? 0),
  // 行金额取已扣商品级优惠的应付金额，保证小票明细合计 = 应付合计
  amount: fenToYuan(item.payableLineAmount ?? 0),
  specs: item.specs.map((spec) => ({
    name: spec.specOptionNameSnapshot,
    extraPrice: calculateSummary({
      itemOriginalAmountCents: spec.extraPriceSnapshot,
      specificationExtraAmountCents: 0,
    }).payableAmount,
  })),
});

/** 组装订单详情状态历史行。 */
export const toDetailHistory = (
  history: ScanOrderDetailSource['histories'][number],
): ScanOrderingOrderDetailPayload['histories'][number] => ({
  fromStatus: history.fromStatus,
  toStatus: history.toStatus,
  reason: history.reason ?? '',
  createdAt: history.createdAt.toISOString(),
});

/** 组装商家订单详情响应。 */
export const toOrderDetailPayload = (input: {
  order: ScanOrderDetailSource;
  calculateSummary: AmountSummaryCalculator;
  formatPickupNumber: PickupNumberFormatter;
}): ScanOrderingOrderDetailPayload => {
  const { order, calculateSummary, formatPickupNumber } = input;
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    version: order.version,
    table: order.table,
    createdAt: order.createdAt.toISOString(),
    pickupNumber: order.pickupNumber,
    pickupNumberLabel: formatPickupNumber(order.pickupNumber),
    amountSummary: toAmountSummary(order, calculateSummary),
    items: order.items.map((item) => toDetailItem(item, calculateSummary)),
    histories: order.histories.map(toDetailHistory),
  };
};
