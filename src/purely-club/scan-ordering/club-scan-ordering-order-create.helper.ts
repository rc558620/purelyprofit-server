/**
 * 扫码点餐建单的数据装配与单表写入。
 *
 * 从 `ClubScanOrderingOrderService.create` 拆出：这里是纯粹的「入参 → 写入数据 /
 * 实时事件 payload」形状转换，不编排事务、不做跨表业务判断，因此可独立推演；
 * 主服务只保留幂等、门店一致性、新客额度这些真正的业务闸门。
 */
import type { Prisma } from '@prisma/client';
import type { CreateClubScanOrderDto } from './dto/club-scan-ordering.dto';
import { createScanOrderNo } from './club-scan-ordering-order.utils';
import type {
  OrderAmountBreakdown,
  PricedCartItem,
  ScanOrderingOrderItemCreateData,
} from './club-scan-ordering-order.types';
import type { PromotionAdapterResult } from './scan-ordering-promotion.adapter';
import type { OrderCreatedPayload } from './scan-ordering-realtime.types';

/** 待支付订单的支付超时（15 分钟）：建单时写入 paymentExpiresAt。 */
export const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

/** 建单幂等作用域：与 actorId + idempotencyKey 组成幂等记录唯一键。 */
export const IDEMPOTENCY_SCOPE = 'club:scan-order:create';

/** 建单响应的稳定形状（同时作为幂等回放快照） */
export interface CreatedScanOrderResponse {
  id: number;
  orderNo: string;
  payableAmount: number;
  paymentExpiresAt: string | null;
  version: number;
}

/** 桌台位置快照：建单通知要拼「区域 · 类型 · 桌位」 */
export interface CreateOrderTableSummary {
  name: string;
  area: { name: string } | null;
  type: { name: string } | null;
}

/** 建单所需的会话快照（由 requireSession 一次查出，含桌台位置） */
export interface CreateOrderSession {
  id: number;
  storeId: number;
  tableId: number | null;
  diningRoundId: string;
  guestCount: number;
  table: CreateOrderTableSummary | null;
}

/** 下单前的定价与促销结果（一次取数，建单与实时通知复用） */
export interface CreateOrderPricing {
  pricingVersion: string;
  pricedItems: PricedCartItem[];
  promotionResult: PromotionAdapterResult;
  amounts: OrderAmountBreakdown;
}

/** 订单主表写入入参 */
export interface CreateScanOrderRowInput {
  session: CreateOrderSession;
  dto: CreateClubScanOrderDto;
  pricing: CreateOrderPricing;
  /** 行级优惠分摊后的明细（由定价服务计算，此处只落库） */
  items: ScanOrderingOrderItemCreateData[];
  clubUserId: number;
  idempotencyKey: string;
  expiresAt: Date;
}

/** 订单创建后实时通知所需的入参 */
export interface OrderCreatedPayloadInput {
  session: CreateOrderSession;
  order: CreatedScanOrderResponse;
  pricedItems: PricedCartItem[];
  /** 应付金额（分，已扣积分抵扣） */
  amountFen: number;
  remark?: string;
  createdAt: Date;
}

/**
 * 营销快照：只保留金额派生（积分抵扣 / 优惠清单）所需的字段。
 * 落库为 JSON，商家端与 C 端都不直接消费，查询响应会被剔除。
 */
const buildMarketingSnapshot = (
  promotion: PromotionAdapterResult,
  amounts: OrderAmountBreakdown,
  usePoints: boolean,
): Prisma.InputJsonObject => ({
  memberBenefits: promotion.memberBenefits,
  appliedPromotions: promotion.appliedPromotions,
  breakdownItems: promotion.breakdownItems,
  availableCoupons: promotion.availableCoupons.filter(
    (coupon) => coupon.usable,
  ),
  productDiscountAmount: amounts.productDiscountAmount,
  orderDiscountAmount: amounts.orderDiscountAmount,
  usePoints,
  pointsDeductAmount: promotion.pointsDeductAmount,
  pointsUsed: promotion.pointsUsed,
  redeemRatioPoints: promotion.redeemRatioPoints,
  availablePoints: promotion.availablePoints,
  pointsSettlementStatus: 'pending',
});

/**
 * 写入订单主表（含明细与规格快照），返回建单响应所需的最小列。
 * 金额一律以「分」落库，元换算只在查询响应阶段做。
 */
export const createScanOrderRow = async (
  tx: Prisma.TransactionClient,
  input: CreateScanOrderRowInput,
): Promise<CreatedScanOrderResponse> => {
  const { session, dto, pricing, items } = input;
  const order = await tx.scanOrders.create({
    data: {
      storeId: session.storeId,
      tableId: session.tableId,
      sessionId: session.id,
      clubUserId: input.clubUserId,
      diningRoundId: session.diningRoundId,
      orderNo: createScanOrderNo(),
      guestCount: dto.guestCount,
      remark: dto.remark,
      idempotencyKey: input.idempotencyKey,
      pricingVersion: pricing.pricingVersion,
      marketingSnapshot: buildMarketingSnapshot(
        pricing.promotionResult,
        pricing.amounts,
        dto.usePoints === true,
      ),
      itemOriginalAmount: pricing.amounts.itemOriginalAmount,
      specificationExtraAmount: pricing.amounts.specificationExtraAmount,
      productDiscountAmount: pricing.amounts.productDiscountAmount,
      orderDiscountAmount: pricing.amounts.orderDiscountAmount,
      serviceFeeAmount: pricing.amounts.serviceFeeAmount,
      taxAmount: pricing.amounts.taxAmount,
      payableAmount: pricing.promotionResult.afterPointsPayableAmount,
      paymentExpiresAt: input.expiresAt,
      items: { create: items },
    },
    select: {
      id: true,
      orderNo: true,
      payableAmount: true,
      paymentExpiresAt: true,
      version: true,
    },
  });
  return {
    ...order,
    paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
  };
};

/** 建单时写入的首条状态流水：pending_payment → pending_payment，记录创建动作。 */
export const createOrderStatusHistoryRow = async (
  tx: Prisma.TransactionClient,
  orderId: number,
  session: CreateOrderSession,
  clubUserId: number,
): Promise<void> => {
  await tx.scanOrderStatusHistory.create({
    data: {
      orderId,
      storeId: session.storeId,
      fromStatus: 'pending_payment',
      toStatus: 'pending_payment',
      operatorType: 'club_user',
      operatorId: clubUserId,
      reason: '用户创建扫码点餐订单',
    },
  });
};

/** 购物车行转为 ordered：同一份购物车不允许再被第二笔订单消费。 */
export const markCartItemsOrdered = async (
  tx: Prisma.TransactionClient,
  sessionId: number,
): Promise<void> => {
  await tx.scanOrderingCartItem.updateMany({
    where: { sessionId, status: 'active', deletedAt: null },
    data: { status: 'ordered', version: { increment: 1 } },
  });
};

/** 位置展示串：区域 · 类型 · 桌位（如「1楼 · 大厅 · A01」），缺失项自动省略。 */
const resolveLocationLabel = (
  table: CreateOrderTableSummary | null,
): string | null => {
  if (!table) return null;
  return (
    [table.area?.name, table.type?.name, table.name]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(' · ') || null
  );
};

/**
 * 组装 order.created 实时事件 payload（商家端新订单通知展示快照）。
 * 必须在事务提交后调用：Profit 端收到通知会立刻回读订单。
 */
export const buildOrderCreatedPayload = (
  input: OrderCreatedPayloadInput,
): OrderCreatedPayload => ({
  storeId: input.session.storeId,
  orderId: input.order.id,
  sessionId: input.session.id,
  // 带上创建时的乐观锁版本：商家端可据此直接接单（缺失时首次接单必然 409）
  version: input.order.version,
  status: 'pending_payment',
  paymentStatus: 'unpaid',
  fulfillmentStatus: 'preparing',
  orderNo: input.order.orderNo,
  tableName: input.session.table?.name ?? null,
  locationLabel: resolveLocationLabel(input.session.table),
  items: input.pricedItems.map((item) => ({
    productName: item.productName,
    quantity: item.quantity,
  })),
  amountFen: input.amountFen,
  remark: input.remark?.trim() || null,
  createdAt: input.createdAt.toISOString(),
});
