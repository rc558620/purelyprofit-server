import type { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import {
  queryCustomerGiftBalanceCents,
  queryCustomerRechargeRefundSums,
  queryCustomerRecentConsumptions,
  queryCustomerRecentRecharges,
} from './marketing.query';
import { mapConsumptionRow, mapRechargeRow } from './marketing.mapper';

/**
 * 计算顾客详情中的财务汇总数据（充值/退款/赠送余额/积分抵扣/近期流水）
 */
export async function computeCustomerFinance(
  prisma: PrismaService,
  customerId: number,
  balanceCents: number,
) {
  const [
    recentRecharges,
    recentConsumptions,
    { rechargeCents, refundCents },
    consumptionPointsSummary,
    giftBalanceCents,
  ] = await Promise.all([
    queryCustomerRecentRecharges(prisma, customerId, 5),
    queryCustomerRecentConsumptions(prisma, customerId, 5),
    // 充值 / 退款本金一次 groupBy 取回，替代原先两次 aggregate
    queryCustomerRechargeRefundSums(prisma, customerId),
    prisma.marketingConsumption.aggregate({
      where: { customerId },
      _sum: { pointsDeducted: true },
    }),
    // 与上面 4 个查询无依赖，并行发起省 1 次往返（原实现串行 await）
    queryCustomerGiftBalanceCents(prisma, customerId),
  ]);

  // B2: 最大可退金额受当前实际余额约束
  const principalRefundableCents = Math.max(0, rechargeCents - refundCents);
  const balanceConstrainedCents = Math.max(0, balanceCents - giftBalanceCents);
  const refundableCents = Math.min(
    principalRefundableCents,
    balanceConstrainedCents,
  );

  return {
    totalRecharge: Money.fromDbCents(rechargeCents).toOutputYuan(),
    refundableAmount: Money.fromDbCents(refundableCents).toOutputYuan(),
    giftBalance: Money.fromDbCents(giftBalanceCents).toOutputYuan(),
    totalPointsDeducted: Money.fromDbCents(
      consumptionPointsSummary._sum.pointsDeducted ?? 0,
    ).toOutputYuan(),
    recentRecharges: recentRecharges.map(mapRechargeRow),
    recentConsumptions: recentConsumptions.map(mapConsumptionRow),
  };
}
