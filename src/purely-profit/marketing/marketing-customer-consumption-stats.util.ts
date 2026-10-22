import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 顾客消费口径统计结果（分）。
 *
 * 事实源为 `marketing_consumptions` 流水（消费金额含积分抵扣，见各结算链路注释）：
 * - 累计消费 = 流水金额求和 − 已退款团购券的冲减金额（含积分抵扣部分）；
 * - 消费次数 = 正向流水笔数 − 已退款订单笔数（已取消的消费不计次）。
 *
 * 退款不从流水里扣：`marketing_consumptions` 有 `amount >= 0` 的库级约束，
 * 且流水是消费发生时的审计事实，取消消费属于另一张单据（`club_voucher_orders`）。
 */
export interface CustomerConsumptionStats {
  /** 累计消费（分，已冲减退款） */
  totalSpentCents: number;
  /** 有效消费笔数（已退款订单不计次） */
  visitCount: number;
  /** 最后消费时间（正向流水的最大 createdAt，退款不影响） */
  lastVisitAt: Date | null;
}

/**
 * 已退款团购券的冲减金额与笔数。
 *
 * 只统计余额支付的退款：流水本身只在余额支付结算时写入，
 * 微信支付的券订单既不进流水也不进物化字段，两边口径必须严格对称。
 */
export async function computeCustomerRefundStats(
  prisma: PrismaService,
  customerId: number,
): Promise<{ refundedCents: number; refundCount: number }> {
  const refunds = await prisma.clubVoucherOrder.aggregate({
    where: {
      customerId,
      status: 'refunded',
      paymentChannel: 'balance',
      refundAmountFen: { not: null },
    },
    _sum: { refundAmountFen: true, pointsDeductFen: true },
    _count: { _all: true },
  });

  return {
    // 退款单的 refundAmountFen 是实付金额，消费流水 amount 含积分抵扣，
    // 因此冲减时必须把积分抵扣部分一并计入
    refundedCents:
      (refunds._sum.refundAmountFen ?? 0) + (refunds._sum.pointsDeductFen ?? 0),
    refundCount: refunds._count._all,
  };
}

/**
 * 按消费流水实时聚合顾客的累计消费 / 次数 / 最后消费时间。
 *
 * 营销详情与会员护理档案等所有展示端必须共用本函数：
 * `marketing_customers.total_spent / visit_count` 只是物化缓存，
 * 任何一条写入链路漏更新都会让不同页面显示不同数字。
 */
export async function computeCustomerConsumptionStats(
  prisma: PrismaService,
  customerId: number,
): Promise<CustomerConsumptionStats> {
  const [aggregated, positiveAggregated, refundStats] = await Promise.all([
    prisma.marketingConsumption.aggregate({
      where: { customerId },
      _sum: { amount: true },
    }),
    prisma.marketingConsumption.aggregate({
      where: { customerId, amount: { gt: 0 } },
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    computeCustomerRefundStats(prisma, customerId),
  ]);

  return {
    totalSpentCents: Math.max(
      (aggregated._sum.amount ?? 0) - refundStats.refundedCents,
      0,
    ),
    visitCount: Math.max(
      positiveAggregated._count._all - refundStats.refundCount,
      0,
    ),
    lastVisitAt: positiveAggregated._max.createdAt ?? null,
  };
}
