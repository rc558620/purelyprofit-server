import {
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  HandoverStatus,
  SpaceSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import {
  ORDER_ITEMS_LIMIT,
  buildShiftDateRange,
  dbCentsToOutputYuan,
  extendShiftRangeToReference,
} from './handover.shared';
import type {
  HandoverPageMetrics,
  OrderItemRow,
  ResolvedHandoverPageShiftContext,
  SaleOrderRefundRow,
  SettledSpaceSessionRow,
} from './handover.shared';
import {
  SALE_ORDER_ITEM_SELECT,
  SALE_ORDER_REFUND_SELECT,
  SETTLED_SPACE_SESSION_SELECT,
  buildCashFlowWhere,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderItemOrderWhere,
  buildSaleOrderWhere,
  type ShiftRangeLike,
} from './handover-page-query.builders';
import { computeRefundAmountFromSessions } from './handover-page-payment';

/**
 * 解析交班页统计时间范围：
 * 班次时间范围扩展至当前时间后，再按"本班次内最近一次已完成交班"收窄起点，
 * 过滤上一班未交班时段的数据。
 */
export const resolvePageShiftRange = async (
  prisma: PrismaService,
  shiftContext: ResolvedHandoverPageShiftContext,
  referenceAt: Date,
): Promise<ShiftRangeLike> => {
  const shiftRange = extendShiftRangeToReference(
    buildShiftDateRange(
      shiftContext.shiftInfo.startTime,
      shiftContext.shiftInfo.endTime,
      shiftContext.shiftRecord?.date,
    ),
    referenceAt,
  );
  const initializedStartAt = await findShiftInitializedStartAt(
    prisma,
    shiftContext,
    shiftRange.startAt,
    referenceAt,
  );

  return initializedStartAt
    ? {
        startAt: initializedStartAt,
        endAt: shiftRange.endAt,
      }
    : shiftRange;
};

/**
 * 查找同门店内，在本班次开始时间之后、完成的最新交班记录
 * 该交班时刻即为本班次的统计起点（过滤上一班未交班时段的数据）
 * 注：不按 employeeShiftIdSnapshot 过滤，因为老板主账号交班时不写 snapshot
 */
const findShiftInitializedStartAt = async (
  prisma: PrismaService,
  shiftContext: ResolvedHandoverPageShiftContext,
  shiftStartAt: Date,
  referenceAt: Date,
): Promise<Date | null> => {
  const previousHandover = await prisma.storeHandoverRecord.findFirst({
    where: {
      storeId: shiftContext.membership.storeId,
      status: HandoverStatus.completed,
      handoverAt: {
        gt: shiftStartAt,
        lte: referenceAt,
      },
    },
    select: {
      handoverAt: true,
    },
    orderBy: [{ handoverAt: 'desc' }, { id: 'desc' }],
  });

  return previousHandover?.handoverAt ?? null;
};

export const loadPageMetrics = async (
  prisma: PrismaService,
  shiftContext: ResolvedHandoverPageShiftContext,
  startAt: Date,
  endAt: Date,
): Promise<HandoverPageMetrics> => {
  const { membership } = shiftContext;
  const shiftRange = { startAt, endAt };
  const orderWhere = buildSaleOrderWhere(membership.storeId, shiftRange);
  const additionalOrderWhere = buildNonSpaceSessionOrderWhere(
    membership.storeId,
    shiftRange,
  );
  const cashFlowWhere = buildCashFlowWhere(membership.storeId, shiftRange);
  const [
    paymentOrderItems,
    orderItems,
    orderCount,
    spaceRevenue,
    scanOrderingRevenue,
    additionalRevenue,
    saleOrderRefunds,
    pettyCash,
    settledSpaceSessions,
  ] = await Promise.all([
    loadPaymentOrderItems(prisma, membership.storeId, shiftRange),
    loadRecentOrderItems(prisma, membership.storeId, shiftRange),
    prisma.saleOrder.count({ where: orderWhere }),
    loadSpaceRevenue(prisma, membership.storeId, startAt, endAt),
    loadScanOrderingRevenue(prisma, membership.storeId, startAt, endAt),
    loadAdditionalRevenue(prisma, additionalOrderWhere),
    loadSaleOrderRefunds(prisma, membership.storeId, startAt, endAt),
    loadPettyCash(prisma, cashFlowWhere),
    loadSettledSpaceSessions(prisma, membership.storeId, startAt, endAt),
  ]);

  // 退款金额：SpaceSession 预付溢出 + 扫码点餐退款明细（SaleOrderRefund）双重累加
  // computeRefundAmountFromSessions 返回元金额，必须按 fromInputYuan 转分后累加
  // （与 handover-records-revenue.service 的 refundAmount 计算保持一致）
  const scanOrderingRefundCents = saleOrderRefunds.reduce(
    (sum, refund) => sum + Number(refund.amount ?? 0),
    0,
  );
  const refundAmount = Money.fromDbCents(scanOrderingRefundCents)
    .add(
      Money.fromInputYuan(
        computeRefundAmountFromSessions(settledSpaceSessions),
      ),
    )
    .toOutputYuan();

  // 门店主账号 user.id：操作员职位判定依据（主账号=紫）
  const storeOwnerUserId = await loadStoreOwnerUserId(
    prisma,
    membership.storeId,
  );

  return {
    orderCount,
    paymentOrderItems,
    orderItems,
    saleOrderRefundItems: saleOrderRefunds,
    additionalRevenueAmount: dbCentsToOutputYuan(
      additionalRevenue._sum.totalRevenue,
    ),
    spaceRevenueAmount: Money.fromDbCents(spaceRevenue._sum.timeCost ?? 0)
      .add(Money.fromDbCents(spaceRevenue._sum.itemsCost ?? 0))
      .add(Money.fromDbCents(scanOrderingRevenue._sum.totalRevenue ?? 0))
      .toOutputYuan(),
    refundAmount,
    pettyCashAmount: dbCentsToOutputYuan(pettyCash._sum.amount),
    settledSpaceSessions,
    storeOwnerUserId,
  };
};

/** 读取门店主账号 user.id（store.ownerId） */
const loadStoreOwnerUserId = async (
  prisma: PrismaService,
  storeId: number,
): Promise<number | null> => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true },
  });
  return store?.ownerId ?? null;
};

const loadPaymentOrderItems = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftRangeLike,
): Promise<OrderItemRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      order: buildSaleOrderItemOrderWhere(storeId, shiftRange),
    },
    select: SALE_ORDER_ITEM_SELECT,
  });

const loadRecentOrderItems = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftRangeLike,
): Promise<OrderItemRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      order: buildSaleOrderItemOrderWhere(storeId, shiftRange),
    },
    select: SALE_ORDER_ITEM_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ORDER_ITEMS_LIMIT,
  });

const loadSpaceRevenue = (
  prisma: PrismaService,
  storeId: number,
  startAt: Date,
  endAt: Date,
) =>
  prisma.spaceSession.aggregate({
    where: {
      storeId,
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: startAt,
        lte: endAt,
      },
    },
    _sum: { timeCost: true, itemsCost: true },
  });

/** 扫码点餐订单（purelyClub 下单）收入：餐饮账号下计入 spaceRevenue（扫码点餐指标） */
const loadScanOrderingRevenue = (
  prisma: PrismaService,
  storeId: number,
  startAt: Date,
  endAt: Date,
) =>
  prisma.saleOrder.aggregate({
    where: {
      storeId,
      date: {
        gte: startAt,
        lte: endAt,
      },
      scanOrderId: { not: null },
      totalRevenue: { gt: 0 },
    },
    _sum: { totalRevenue: true },
  });

const loadSettledSpaceSessions = (
  prisma: PrismaService,
  storeId: number,
  startAt: Date,
  endAt: Date,
): Promise<SettledSpaceSessionRow[]> =>
  prisma.spaceSession.findMany({
    where: {
      storeId,
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: startAt,
        lte: endAt,
      },
    },
    select: SETTLED_SPACE_SESSION_SELECT,
  });

const loadAdditionalRevenue = (
  prisma: PrismaService,
  orderWhere: ReturnType<typeof buildNonSpaceSessionOrderWhere>,
) =>
  prisma.saleOrder.aggregate({
    where: orderWhere,
    _sum: { totalRevenue: true },
  });

/**
 * 扫码点餐退款明细（SaleOrderRefund）：
 * 当前班次时间范围内的扫码点餐退款，在交班明细中展示为负数退款行。
 * 按 refundedAt（退款时间）过滤，班次范围已扩展至当前时间，
 * 确保班次期间内发生的退款都能计入。
 */
const loadSaleOrderRefunds = (
  prisma: PrismaService,
  storeId: number,
  startAt: Date,
  endAt: Date,
): Promise<SaleOrderRefundRow[]> =>
  prisma.saleOrderRefund.findMany({
    where: {
      storeId,
      refundedAt: {
        gte: startAt,
        lte: endAt,
      },
    },
    select: SALE_ORDER_REFUND_SELECT,
    orderBy: [{ refundedAt: 'desc' }, { id: 'desc' }],
  });

const loadPettyCash = (
  prisma: PrismaService,
  cashFlowWhere: ReturnType<typeof buildCashFlowWhere>,
) =>
  prisma.financeCashFlowRecord.aggregate({
    where: {
      ...cashFlowWhere,
      direction: FinanceCashFlowDirection.income,
      category: FinanceCashFlowCategory.transfer_in,
      payment: FinanceCashFlowPayment.cash,
    },
    _sum: { amount: true },
  });
