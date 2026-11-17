import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  SpaceSessionStatus,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ShiftDateRange } from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  SALE_ORDER_REFUND_SELECT,
  SETTLED_SPACE_SESSION_SELECT,
  buildCashFlowWhere,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderWhere,
} from './handover-page-query.builders';

/** SaleOrder 收入聚合结果（_sum.totalRevenue，单位：分） */
export type SaleOrderRevenueSum = Prisma.GetSaleOrderAggregateType<{
  _sum: { totalRevenue: true };
}>;

/** SpaceSession 消费聚合结果（_sum.timeCost / _sum.itemsCost，单位：分） */
export type SpaceSessionRevenueSum = Prisma.GetSpaceSessionAggregateType<{
  _sum: { timeCost: true; itemsCost: true };
}>;

/** 现金流水金额聚合结果（_sum.amount，单位：分） */
export type CashFlowAmountSum = Prisma.GetFinanceCashFlowRecordAggregateType<{
  _sum: { amount: true };
}>;

/** 交班明细订单行（SALE_ORDER_ITEM_SELECT） */
export type SaleOrderItemDetailRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof SALE_ORDER_ITEM_SELECT;
}>;

/** 已结账空间会话行（SETTLED_SPACE_SESSION_SELECT） */
export type SettledSpaceSessionDetailRow = Prisma.SpaceSessionGetPayload<{
  select: typeof SETTLED_SPACE_SESSION_SELECT;
}>;

/** 扫码点餐退款行（SALE_ORDER_REFUND_SELECT） */
export type SaleOrderRefundDetailRow = Prisma.SaleOrderRefundGetPayload<{
  select: typeof SALE_ORDER_REFUND_SELECT;
}>;

/** 交班记录营收详情的数据源：一次取齐，service 只做口径拼装 */
export type RecordRevenueDetailSource = {
  /** 班次内全部订单明细（支付方式汇总用全量，展示用前 N 条） */
  orderItems: SaleOrderItemDetailRow[];
  orderCount: number;
  spaceRevenue: SpaceSessionRevenueSum;
  scanOrderingRevenue: SaleOrderRevenueSum;
  additionalRevenue: SaleOrderRevenueSum;
  pettyCash: CashFlowAmountSum;
  settledSpaceSessions: SettledSpaceSessionDetailRow[];
  /** 扫码点餐退款明细（SaleOrderRefund） */
  saleOrderRefunds: SaleOrderRefundDetailRow[];
};

/**
 * 非空间销售订单收入：仅统计 regular 销售单
 * （spaceSession IS NULL 且非扫码点餐订单），空间/扫码收入单独统计，避免重复计入。
 */
export const loadAdditionalRevenueSum = (
  prisma: PrismaService,
  orderWhere: Prisma.SaleOrderWhereInput,
): Promise<SaleOrderRevenueSum> =>
  prisma.saleOrder.aggregate({
    where: orderWhere,
    _sum: { totalRevenue: true },
  });

/** 空间会话消费收入（已结账会话的 timeCost + itemsCost） */
export const loadSpaceRevenueSum = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<SpaceSessionRevenueSum> =>
  prisma.spaceSession.aggregate({
    where: {
      storeId,
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
    },
    _sum: { timeCost: true, itemsCost: true },
  });

/** 扫码点餐订单（purelyClub 下单）收入：餐饮账号下计入 spaceRevenue（扫码点餐指标） */
export const loadScanOrderingRevenueSum = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<SaleOrderRevenueSum> =>
  prisma.saleOrder.aggregate({
    where: {
      storeId,
      date: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
      scanOrderId: { not: null },
      totalRevenue: { gt: 0 },
    },
    _sum: { totalRevenue: true },
  });

/** 备用金：班次内现金 - 内部转账收入 */
export const loadPettyCashSum = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<CashFlowAmountSum> =>
  prisma.financeCashFlowRecord.aggregate({
    where: {
      ...buildCashFlowWhere(storeId, shiftRange),
      direction: FinanceCashFlowDirection.income,
      category: FinanceCashFlowCategory.transfer_in,
      payment: FinanceCashFlowPayment.cash,
    },
    _sum: { amount: true },
  });

/** 班次内全部订单明细：合并原「支付聚合全量」与「展示前 N 条」两次查询 */
export const loadShiftOrderItems = (
  prisma: PrismaService,
  storeId: number,
  orderWhere: Prisma.SaleOrderWhereInput,
): Promise<SaleOrderItemDetailRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      // 与实时交班页口径一致：不排除已退款订单，退款单的下单行与退款行同时展示
      order: orderWhere,
    },
    select: SALE_ORDER_ITEM_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

/**
 * 已结账空间会话：退款 / 客人应付的数据源。
 * ⚠️ sessionRenewRecords 不可移除，退款与应付计算依赖续费独立累加。
 */
export const loadSettledSpaceSessions = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<SettledSpaceSessionDetailRow[]> =>
  prisma.spaceSession.findMany({
    where: {
      storeId,
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
    },
    select: SETTLED_SPACE_SESSION_SELECT,
  });

/** 扫码点餐退款明细：交班明细中展示为负数退款行 */
export const loadSaleOrderRefundRows = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<SaleOrderRefundDetailRow[]> =>
  prisma.saleOrderRefund.findMany({
    where: {
      storeId,
      refundedAt: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
    },
    select: SALE_ORDER_REFUND_SELECT,
    orderBy: [{ refundedAt: 'desc' }, { id: 'desc' }],
  });

/** 读取门店主账号 user.id（store.ownerId）：操作员职位判定依据（主账号 = 紫） */
export const loadStoreOwnerUserId = async (
  prisma: PrismaService,
  storeId: number,
): Promise<number | null> => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true },
  });
  return store?.ownerId ?? null;
};

/**
 * 取齐交班记录营收详情所需数据。
 * 前 7 个查询互不依赖，走 Promise.all；退款明细保持原有调用时序（置于其后）。
 */
export const loadRecordRevenueDetailSource = async (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftDateRange,
): Promise<RecordRevenueDetailSource> => {
  const orderWhere = buildSaleOrderWhere(storeId, shiftRange);
  const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
    storeId,
    shiftRange,
  );

  const [
    orderItems,
    orderCount,
    spaceRevenue,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
  ] = await Promise.all([
    loadShiftOrderItems(prisma, storeId, orderWhere),
    prisma.saleOrder.count({ where: orderWhere }),
    loadSpaceRevenueSum(prisma, storeId, shiftRange),
    loadScanOrderingRevenueSum(prisma, storeId, shiftRange),
    loadAdditionalRevenueSum(prisma, additionalOrderWhere),
    loadPettyCashSum(prisma, storeId, shiftRange),
    loadSettledSpaceSessions(prisma, storeId, shiftRange),
  ]);

  const saleOrderRefunds = await loadSaleOrderRefundRows(
    prisma,
    storeId,
    shiftRange,
  );

  return {
    orderItems,
    orderCount,
    spaceRevenue,
    scanOrderingRevenue,
    additionalRevenue,
    pettyCash,
    settledSpaceSessions,
    saleOrderRefunds,
  };
};
