import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { buildPulseDashboardHomeCacheKey } from '../pulse.cache-keys';
import { DEFAULT_HOME_REVENUE_PERIOD } from './dashboard.constants';
import { loadPulseHomeRawData } from './dashboard-home.query';
import {
  buildHomeRevenueRangePair,
  buildHomeRevenueTrend,
} from './dashboard-home.revenue.utils';
import {
  buildOnlineStats,
  buildPartnerStats,
  buildPartnerTopList,
} from './dashboard-home.stats.utils';
import { buildRevenueTypeDistributionFromPlanCounts } from './dashboard-revenue.utils';
import type {
  GetPulseDashboardHomeQueryDto,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';
import type { PulseDashboardHomeResponseDto } from './dto/pulse-dashboard-home.response.dto';

const PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS = 10_000;

@Injectable()
export class PulseDashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getHome(
    _user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    const revenuePeriod = queryDto.revenuePeriod ?? DEFAULT_HOME_REVENUE_PERIOD;
    const region = queryDto.region;
    const regionCode = queryDto.regionCode;
    const cacheKey = buildPulseDashboardHomeCacheKey(
      revenuePeriod,
      region,
      regionCode,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS,
      loadValue: () => this.buildHome(revenuePeriod, region, regionCode),
    });
  }

  private async buildHome(
    revenuePeriod: PulseHomeRevenuePeriodValue,
    region: string | undefined,
    regionCode: string | undefined = undefined,
  ): Promise<PulseDashboardHomeResponseDto> {
    const now = new Date();
    const revenueRange = buildHomeRevenueRangePair(revenuePeriod, now);

    const data = await loadPulseHomeRawData(this.prisma, {
      region,
      regionCode,
      revenueRange,
      now,
    });

    const { revenueTrend, revenueSummary } = buildHomeRevenueTrend(
      data.membershipOrders,
      revenuePeriod,
      now,
    );

    return {
      online: buildOnlineStats(
        data.online.onlineCount,
        data.online.activeAtMsList,
        now,
      ),
      partnerStats: buildPartnerStats({
        totalPartners: data.totalPartners,
        activePartnerCount: data.activePartnerCount,
        newThisMonthPartners: data.newThisMonthPartners,
        promoSummary: data.promoSummary,
      }),
      partnerTop: buildPartnerTopList(data.partnerTopRows),
      revenueTrend,
      revenueSummary,
      revenueTypeBreakdown: buildRevenueTypeDistributionFromPlanCounts(
        data.revenueTypeCounts,
      ),
      pendingApplicationCount: data.pendingApplicationCount,
      generatedAt: Date.now(),
    };
  }
}
