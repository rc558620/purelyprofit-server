import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { ORDER_ITEMS_LIMIT, type ShiftDateRange } from './handover.shared';
import {
  PAYMENT_ORDER_ITEM_SELECT,
  SALE_ORDER_ITEM_SELECT,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderWhere,
  type PaymentOrderItemRow,
} from './handover-page-query.builders';
import {
  loadAdditionalRevenueSum,
  loadPettyCashSum,
  loadSaleOrderRefundRows,
  loadScanOrderingRevenueSum,
  loadSettledSpaceSessions,
  loadSpaceRevenueSum,
  loadStoreOwnerUserId,
  sumSettledSpaceRevenueDbCents,
  type CashFlowAmountSum,
  type SaleOrderRefundDetailRow,
  type SaleOrderRevenueSum,
  type SettledSpaceSessionDetailRow,
  type SpaceSessionRevenueSum,
} from './handover-revenue.loaders';

/**
 * 交班记录营收：本文件只做**编排**（哪几个查询、怎么并行），
 * 单个查询的实现与返回类型全部收敛在 handover-revenue.loaders.ts，
 * 与实时交班页共用同一份 loader，口径不可能分叉。
 */

/**
 * 聚合 loader 与聚合结果类型在此转出，
 * 让既有调用方（handover-records-revenue.service.ts 等）无需改 import 路径。
 */
export {
  loadAdditionalRevenueSum,
  loadScanOrderingRevenueSum,
  loadSpaceRevenueSum,
  sumSettledSpaceRevenueDbCents,
  type CashFlowAmountSum,
  type SaleOrderRevenueSum,
  type SpaceSessionRevenueSum,
  type SettledSpaceSessionDetailRow,
  type SaleOrderRefundDetailRow,
};

/** 交班明细订单行（SALE_ORDER_ITEM_SELECT） */
export type SaleOrderItemDetailRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof SALE_ORDER_ITEM_SELECT;
}>;

/** 交班记录营收详情的数据源：一次取齐，service 只做口径拼装 */
export type RecordRevenueDetailSource = {
  /**
   * 支付方式汇总数据源：班次内【全部】订单明细，但只取分桶必需字段
   * （PAYMENT_ORDER_ITEM_SELECT）。汇总必须覆盖全量，因此不能分页。
   */
  paymentOrderItems: PaymentOrderItemRow[];
  /** 展示用订单明细：按分页切片（SALE_ORDER_ITEM_SELECT，含展示字段） */
  orderItems: SaleOrderItemDetailRow[];
  /** 展示用订单明细的总行数：前端据此判断「是否还有更多」 */
  orderItemsTotal: number;
  orderCount: number;
  scanOrderingRevenue: SaleOrderRevenueSum;
  additionalRevenue: SaleOrderRevenueSum;
  pettyCash: CashFlowAmountSum;
  settledSpaceSessions: SettledSpaceSessionDetailRow[];
  /** 扫码点餐退款明细（SaleOrderRefund） */
  saleOrderRefunds: SaleOrderRefundDetailRow[];
  /** 门店主账号 user.id（store.ownerId）：操作员职位判定依据（主账号 = 紫） */
  storeOwnerUserId: number | null;
};

/** 展示用订单明细的分页参数 */
export type RecordOrderItemsPaging = {
  limit: number;
  offset: number;
};

/** 分页入参（来自 query，可能缺省或越界，需要归一化） */
export type RecordOrderItemsPagingInput = {
  limit?: number;
  offset?: number;
};

export const DEFAULT_RECORD_ORDER_ITEMS_PAGING: RecordOrderItemsPaging = {
  limit: ORDER_ITEMS_LIMIT,
  offset: 0,
};

/**
 * 归一化展示明细分页参数。
 * limit 上限收口在 ORDER_ITEMS_LIMIT，避免前端传超大值把详情接口变回全量查询。
 */
export const normalizeRecordOrderItemsPaging = (
  input?: RecordOrderItemsPagingInput,
): RecordOrderItemsPaging => {
  const limit = Math.min(
    Math.max(input?.limit ?? ORDER_ITEMS_LIMIT, 1),
    ORDER_ITEMS_LIMIT,
  );
  const offset = Math.max(input?.offset ?? 0, 0);

  return { limit, offset };
};

/**
 * 支付方式汇总数据源：班次内全部订单明细的窄字段投影。
 *
 * ─── 为什么与展示明细分开查 ──────────────────────────────────────────
 * 支付方式汇总必须覆盖全量行（否则金额会少算），而展示明细只需要前 N 行。
 * 旧实现一次拉全量 SALE_ORDER_ITEM_SELECT 再在内存 slice，等于为了展示前
 * N 行付出了「全部行 × 全部展示字段」的 join 与传输成本。
 * 拆开后：汇总走窄字段（无 scanOrder.items.specs、operatorStaff、
 * sessionItems 等深层嵌套），展示走 DB 侧分页（take/skip）。
 */
export const loadPaymentOrderItems = (
  prisma: PrismaService,
  storeId: number,
  orderWhere: Prisma.SaleOrderWhereInput,
): Promise<PaymentOrderItemRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      // 与实时交班页口径一致：不排除已退款订单，退款单的下单行与退款行同时展示
      order: orderWhere,
    },
    select: PAYMENT_ORDER_ITEM_SELECT,
  });

/** 展示用订单明细：DB 侧分页（与实时交班页的 take 口径一致，额外支持 offset） */
export const loadDisplayOrderItems = (
  prisma: PrismaService,
  storeId: number,
  orderWhere: Prisma.SaleOrderWhereInput,
  paging: RecordOrderItemsPaging,
): Promise<SaleOrderItemDetailRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      order: orderWhere,
    },
    select: SALE_ORDER_ITEM_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: paging.limit,
    skip: paging.offset,
  });

/** 展示用订单明细的总行数（分页提示用） */
export const countDisplayOrderItems = (
  prisma: PrismaService,
  storeId: number,
  orderWhere: Prisma.SaleOrderWhereInput,
): Promise<number> =>
  prisma.saleOrderItem.count({
    where: {
      storeId,
      order: orderWhere,
    },
  });

/**
 * 取齐交班记录营收详情所需数据。
 * 全部 8 个查询互不依赖（退款明细、门店主账号与其余聚合之间也没有先后关系），
 * 统一走一次 Promise.all：DB 往返从「4 段串行」压缩为「1 段并行」。
 *
 * ⚠️ 空间管理营收【不再】单独跑 spaceSession.aggregate：
 * loadSettledSpaceSessions 的 where 与之完全一致，行数据即唯一事实来源，
 * 由 sumSettledSpaceRevenueDbCents 内存累加（与实时交班页同一函数）。
 * 详情路径此前漏了这一点，等于同一个集合上跑两遍（聚合 + 取行）。
 */
export const loadRecordRevenueDetailSource = async (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
  paging: RecordOrderItemsPaging = DEFAULT_RECORD_ORDER_ITEMS_PAGING,
): Promise<RecordRevenueDetailSource> => {
  const orderWhere = buildSaleOrderWhere(storeId, shiftRange);
  const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
    storeId,
    shiftRange,
  );

  const [
    paymentOrderItems,
    orderItems,
    orderItemsTotal,
    orderCount,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
    saleOrderRefunds,
    storeOwnerUserId,
  ] = await Promise.all([
    loadPaymentOrderItems(prisma, storeId, orderWhere),
    loadDisplayOrderItems(prisma, storeId, orderWhere, paging),
    countDisplayOrderItems(prisma, storeId, orderWhere),
    prisma.saleOrder.count({ where: orderWhere }),
    loadScanOrderingRevenueSum(prisma, storeId, shiftRange),
    loadAdditionalRevenueSum(prisma, additionalOrderWhere),
    loadPettyCashSum(prisma, storeId, shiftRange),
    loadSettledSpaceSessions(prisma, storeId, shiftRange),
    loadSaleOrderRefundRows(prisma, storeId, shiftRange),
    loadStoreOwnerUserId(prisma, storeId),
  ]);

  return {
    paymentOrderItems,
    orderItems,
    orderItemsTotal,
    orderCount,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
    saleOrderRefunds,
    storeOwnerUserId,
  };
};
