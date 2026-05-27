import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMarketingOverviewCacheKey,
} from '../../redis/cache-keys';
import { RedisService } from '../../redis/redis.service';
import type { MarketingOverviewDto } from './dto/marketing-response.dto';
import {
  buildEmptyMarketingOverview,
  buildOverviewLast30Days,
  buildOverviewMonthlyTrend,
} from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';

const MARKETING_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MARKETING_OVERVIEW_REFRESH_AFTER_MS = 30_000;

type MarketingOverviewCachePayload = {
  generatedAt: number;
  refreshAt: number;
  data: MarketingOverviewDto;
};

@Injectable()
export class MarketingOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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

    const cacheKey = buildMarketingOverviewCacheKey(resolvedStoreId);
    const cachedPayload =
      await this.redisService.getJson<MarketingOverviewCachePayload>(cacheKey);

    if (cachedPayload !== null) {
      this.scheduleOverviewRefresh(
        cacheKey,
        resolvedStoreId,
        cachedPayload.refreshAt,
      );
      return cachedPayload.data;
    }

    return this.refreshOverviewCache(cacheKey, resolvedStoreId);
  }

  private scheduleOverviewRefresh(
    cacheKey: string,
    storeId: number,
    refreshAt: number,
  ): void {
    if (refreshAt > Date.now()) {
      return;
    }

    this.redisService.runBackgroundRefresh(
      buildCacheRefreshTaskKey(cacheKey),
      async () => {
        await this.refreshOverviewCache(cacheKey, storeId);
      },
    );
  }

  private async refreshOverviewCache(
    cacheKey: string,
    storeId: number,
  ): Promise<MarketingOverviewDto> {
    const data = await this.buildOverview(storeId);
    const now = Date.now();

    await this.redisService.setJson(
      cacheKey,
      {
        generatedAt: now,
        refreshAt: now + MARKETING_OVERVIEW_REFRESH_AFTER_MS,
        data,
      } satisfies MarketingOverviewCachePayload,
      MARKETING_OVERVIEW_CACHE_TTL_SECONDS,
    );

    return data;
  }

  private async buildOverview(storeId: number): Promise<MarketingOverviewDto> {
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
        where: { storeId, visitCount: { gt: 0 } },
      }),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId },
      }),
      this.prisma.marketingRecharge.findMany({
        where: {
          storeId,
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
