import { HandoverStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { Money, type MoneyDbCentsInput } from '../../../shared/money.utils';
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
  SettledSpaceSessionRow,
} from './handover.shared';
import {
  buildSaleStockSnapshotIndex,
  loadSaleStockSnapshotIndex,
} from './handover-stock-snapshot';
import {
  PAYMENT_ORDER_ITEM_SELECT,
  SALE_ORDER_ITEM_SELECT,
  buildNonSpaceSessionOrderWhere,
  buildSaleOrderItemOrderWhere,
  buildSaleOrderWhere,
  type PaymentOrderItemRow,
  type ShiftRangeLike,
} from './handover-page-query.builders';
import {
  loadAdditionalRevenueSum,
  loadPettyCashSum,
  loadSaleOrderRefundRows,
  loadScanOrderingRevenueSum,
  loadSettledSpaceSessions,
  loadStoreOwnerUserId,
  sumSettledSpaceRevenueDbCents,
} from './handover-revenue.loaders';
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
 *
 * 注：不按 employeeShiftIdSnapshot 过滤，因为老板主账号交班时不写 snapshot
 *
 * ⚠️ 这里刻意使用"全店最近一次交班"，而非按交班人收窄：
 * 交接时刻是全店时间线的切分点，上一班延迟交班时其记录已覆盖到该时刻，
 * 若按人收窄会让同一时段营收同时出现在两班的统计里（重复计算）。
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
  const [
    paymentOrderItems,
    orderItems,
    orderCount,
    scanOrderingRevenue,
    additionalRevenue,
    saleOrderRefunds,
    pettyCash,
    settledSpaceSessions,
    // 门店主账号 user.id：原实现在 9 个并行查询之后单独 await，
    // 白白多一次串行往返；它与其余查询无依赖，并入同一批。
    storeOwnerUserId,
  ] = await Promise.all([
    loadPaymentOrderItems(prisma, membership.storeId, shiftRange),
    loadRecentOrderItems(prisma, membership.storeId, shiftRange),
    prisma.saleOrder.count({ where: orderWhere }),
    loadScanOrderingRevenueSum(prisma, membership.storeId, shiftRange),
    loadAdditionalRevenueSum(prisma, additionalOrderWhere),
    loadSaleOrderRefundRows(prisma, membership.storeId, shiftRange),
    loadPettyCashSum(prisma, membership.storeId, shiftRange),
    loadSettledSpaceSessions(prisma, membership.storeId, shiftRange),
    loadStoreOwnerUserId(prisma, membership.storeId),
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

  // 销售时点库存快照：库存列显示该笔销售扣减完成后的库存；
  // 查不到流水的行按「当前库存 + 后续销量」倒推兜底（老订单/被退款流水）
  const preciseStockIndex = await loadSaleStockSnapshotIndex(
    prisma,
    orderItems,
  );
  const saleStockIndex = buildSaleStockSnapshotIndex(
    orderItems,
    preciseStockIndex,
  );

  return {
    orderCount,
    paymentOrderItems,
    orderItems,
    saleStockIndex,
    saleOrderRefundItems: saleOrderRefunds,
    additionalRevenueAmount: dbCentsToOutputYuan(
      additionalRevenue._sum.totalRevenue,
    ),
    spaceRevenueAmount: buildPageSpaceRevenueAmount(
      settledSpaceSessions,
      scanOrderingRevenue._sum.totalRevenue,
    ),
    refundAmount,
    pettyCashAmount: dbCentsToOutputYuan(pettyCash._sum.amount),
    settledSpaceSessions,
    storeOwnerUserId,
  };
};

/**
 * 支付方式汇总数据源：班次内【全部】订单明细（无 take —— 金额汇总不能截断）。
 * 仅 select 支付口径字段（PAYMENT_ORDER_ITEM_SELECT），避免为每行拉取
 * 规格快照 / 操作员 / 空间开台人等纯展示字段。
 */
const loadPaymentOrderItems = (
  prisma: PrismaService,
  storeId: number,
  shiftRange: ShiftRangeLike,
): Promise<PaymentOrderItemRow[]> =>
  prisma.saleOrderItem.findMany({
    where: {
      storeId,
      order: buildSaleOrderItemOrderWhere(storeId, shiftRange),
    },
    select: PAYMENT_ORDER_ITEM_SELECT,
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

/**
 * 空间管理营收（元）= 已结账会话 timeCost + itemsCost + 扫码点餐订单收入。
 *
 * ─── 为什么不再跑 spaceSession.aggregate ────────────────────────────────
 * loadSettledSpaceSessions 的 where（storeId + status=settled + endTime 区间）
 * 与聚合查询完全一致，行数据本身就是同一集合的唯一事实来源。
 * 会话部分的内存累加统一收敛到 sumSettledSpaceRevenueDbCents（与记录详情共用），
 * 省掉一次重复的 DB 往返，且两个口径不可能再分叉。
 *
 * 单位链路与原实现保持一致：DB 分（Decimal|number）→ Money.fromDbCents
 * → 累加 → toOutputYuan()。扫码点餐收入必须留在同一表达式里，
 * 它是 spaceRevenueAmount 的第三个组成部分，漏掉会导致营业额少算。
 */
const buildPageSpaceRevenueAmount = (
  settledSpaceSessions: SettledSpaceSessionRow[],
  scanOrderingTotalRevenueCents: MoneyDbCentsInput | null,
): number =>
  Money.fromDbCents(sumSettledSpaceRevenueDbCents(settledSpaceSessions))
    .add(Money.fromDbCents(scanOrderingTotalRevenueCents ?? 0))
    .toOutputYuan();
