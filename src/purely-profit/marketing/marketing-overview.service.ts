import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { MarketingOverviewDto } from './dto/marketing-response.dto';
import {
  buildEmptyMarketingOverview,
  buildOverviewLast30Days,
  buildOverviewMonthlyTrend,
} from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';

@Injectable()
export class MarketingOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      return buildEmptyMarketingOverview();
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);

    const [
      activeMemberCount,
      balanceSum,
      totalRechargeAgg,
      todayRechargeAgg,
      thisMonthRechargeAgg,
      rechargeCount,
      trendRechargeRows,
    ] = await Promise.all([
      this.prisma.marketingCustomer.count({
        where: { storeId: resolvedStoreId, visitCount: { gt: 0 } },
      }),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId: resolvedStoreId },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId: resolvedStoreId },
      }),
      this.prisma.marketingRecharge.findMany({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: previousYearStart },
          type: { in: ['recharge', 'gift'] },
        },
        select: { createdAt: true, amount: true, giftAmount: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRecharge =
      (totalRechargeAgg._sum.amount ?? 0) +
      (totalRechargeAgg._sum.giftAmount ?? 0);
    const todayRecharge =
      (todayRechargeAgg._sum.amount ?? 0) +
      (todayRechargeAgg._sum.giftAmount ?? 0);
    const thisMonthRecharge =
      (thisMonthRechargeAgg._sum.amount ?? 0) +
      (thisMonthRechargeAgg._sum.giftAmount ?? 0);
    const currentYear = now.getFullYear();

    return {
      totalBalance: balanceSum._sum.balance ?? 0,
      totalRecharge,
      todayRecharge,
      thisMonthRecharge,
      rechargeCount,
      activeMemberCount,
      last30Days: buildOverviewLast30Days(trendRechargeRows),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend(
        trendRechargeRows,
        currentYear,
      ),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend(
        trendRechargeRows,
        currentYear - 1,
      ),
    };
  }
}
