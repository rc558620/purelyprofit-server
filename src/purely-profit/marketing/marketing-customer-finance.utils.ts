import type { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import {
  queryCustomerGiftBalanceCents,
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
    rechargeSummary,
    refundSummary,
    consumptionPointsSummary,
  ] = await Promise.all([
    queryCustomerRecentRecharges(prisma, customerId, 5),
    queryCustomerRecentConsumptions(prisma, customerId, 5),
    prisma.marketingRecharge.aggregate({
      where: { customerId, type: 'recharge' },
      _sum: { amount: true },
    }),
    prisma.marketingRecharge.aggregate({
      where: { customerId, type: 'refund' },
      _sum: { amount: true },
    }),
    prisma.marketingConsumption.aggregate({
      where: { customerId },
      _sum: { pointsDeducted: true },
    }),
  ]);

  const totalRechargeCents = rechargeSummary._sum.amount ?? 0;
  const totalRefundCents = refundSummary._sum.amount ?? 0;
  const giftBalanceCents = await queryCustomerGiftBalanceCents(
    prisma,
    customerId,
  );

  // B2: 最大可退金额受当前实际余额约束
  const principalRefundableCents = Math.max(
    0,
    totalRechargeCents - totalRefundCents,
  );
  const balanceConstrainedCents = Math.max(0, balanceCents - giftBalanceCents);
  const refundableCents = Math.min(
    principalRefundableCents,
    balanceConstrainedCents,
  );

  return {
    totalRecharge: Money.fromDbCents(totalRechargeCents).toOutputYuan(),
    refundableAmount: Money.fromDbCents(refundableCents).toOutputYuan(),
    giftBalance: Money.fromDbCents(giftBalanceCents).toOutputYuan(),
    totalPointsDeducted: Money.fromDbCents(
      consumptionPointsSummary._sum.pointsDeducted ?? 0,
    ).toOutputYuan(),
    recentRecharges: recentRecharges.map(mapRechargeRow),
    recentConsumptions: recentConsumptions.map(mapConsumptionRow),
  };
}
