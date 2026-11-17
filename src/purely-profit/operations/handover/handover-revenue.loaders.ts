import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  SpaceSessionStatus,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { Money, type MoneyDbCentsInput } from '../../../shared/money.utils';
import type { ShiftDateRange } from './handover.shared';
import {
  SALE_ORDER_REFUND_SELECT,
  SETTLED_SPACE_SESSION_SELECT,
  buildCashFlowWhere,
} from './handover-page-query.builders';

/**
 * 交班营收数据源的**唯一** loader 实现。
 *
 * ─── 为什么要收敛成一个文件 ────────────────────────────────────────────
 * 实时交班页（handover-page-metrics.ts）与交班记录详情
 * （handover-records-revenue.query.ts）此前各自维护了一套
 * Space / ScanOrdering / Additional / PettyCash 聚合 + 退款行 + 门店主账号 loader，
 * 逻辑逐行重复。任何一侧改口径（例如漏掉 scanOrderId 判定）都会让
 * 「页面营收」与「记录营收」静默分叉，而两条链路本就要求同一口径。
 *
 * 统一后：**返回类型以 Prisma payload 为准**（SETTLED_SPACE_SESSION_SELECT /
 * SALE_ORDER_REFUND_SELECT / 聚合类型），调用方只负责把 Decimal 显式转成
 * 展示金额（Money.fromDbCents / dbCentsToOutputYuan），转换点集中且可审计。
 */

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

/** 已结账空间会话行（SETTLED_SPACE_SESSION_SELECT） */
export type SettledSpaceSessionDetailRow = Prisma.SpaceSessionGetPayload<{
  select: typeof SETTLED_SPACE_SESSION_SELECT;
}>;

/** 扫码点餐退款行（SALE_ORDER_REFUND_SELECT） */
export type SaleOrderRefundDetailRow = Prisma.SaleOrderRefundGetPayload<{
  select: typeof SALE_ORDER_REFUND_SELECT;
}>;

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

/**
 * 已结账空间会话行：退款 / 客人应付 / 空间管理营收的共同数据源。
 *
 * ⚠️ sessionRenewRecords 不可移除，退款与应付计算依赖续费独立累加。
 * ⚠️ 实时交班页的空间管理营收也复用本查询结果（同 where 不再跑 aggregate），
 * 改动 where 会同时影响营收口径与退款口径。
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

/**
 * 空间管理营收（DB 分）= Σ(已结账会话 timeCost + itemsCost)。
 *
 * loadSettledSpaceSessions 的 where（storeId + status=settled + endTime 区间）
 * 与原 spaceSession.aggregate 完全一致，行数据即同一集合的唯一事实来源：
 * 内存累加与 _sum 逐分等价。
 *
 * 交班页与交班记录详情共用本函数，两侧都不再单独跑一次 aggregate，
 * 既省一次重复 DB 往返，也让「页面营收」与「记录营收」不可能分叉。
 */
export const sumSettledSpaceRevenueDbCents = (
  settledSpaceSessions: readonly {
    timeCost: MoneyDbCentsInput | null;
    itemsCost: MoneyDbCentsInput | null;
  }[],
): number =>
  Money.sum(
    settledSpaceSessions.map((session) =>
      Money.fromDbCents(session.timeCost ?? 0).add(
        Money.fromDbCents(session.itemsCost ?? 0),
      ),
    ),
  ).toDbCents();

/**
 * 扫码点餐退款明细（SaleOrderRefund）：
 * 交班明细中展示为负数退款行。按 refundedAt（退款时间）过滤，
 * 班次范围已扩展至当前时间，确保班次期间内发生的退款都能计入。
 */
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
