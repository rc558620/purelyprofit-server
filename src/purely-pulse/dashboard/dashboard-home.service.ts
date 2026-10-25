import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { parseShanghaiDateText } from '../../shared/shanghai-time.utils';
import { buildPulseDashboardHomeCacheKey } from '../pulse.cache-keys';
import { DEFAULT_HOME_REVENUE_PERIOD } from './dashboard.constants';
import { loadPulseHomeRawData } from './dashboard-home.query';
import {
  buildHomeRevenueTrend,
  resolveHomeRevenueRangePlan,
  type HomeRevenueRangeParams,
} from './dashboard-home.revenue.utils';
import {
  buildOnlineStats,
  buildPartnerStats,
  buildPartnerTopList,
} from './dashboard-home.stats.utils';
import { buildRevenueTypeDistributionFromPlanCounts } from './dashboard-revenue.utils';
import type { GetPulseDashboardHomeQueryDto } from './dto/pulse-dashboard-query.dto';
import type { PulseDashboardHomeResponseDto } from './dto/pulse-dashboard-home.response.dto';

const PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS = 10_000;

/** 首页聚合查询条件：Region 作用于合伙人统计，自定义日期作用于收入图表。 */
interface BuildHomeParams extends HomeRevenueRangeParams {
  region: string | undefined;
  regionCode: string | undefined;
}

@Injectable()
export class PulseDashboardHomeService {
  private readonly logger = new Logger(PulseDashboardHomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getHome(
    _user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    const params: BuildHomeParams = {
      period: queryDto.revenuePeriod ?? DEFAULT_HOME_REVENUE_PERIOD,
      region: queryDto.region,
      regionCode: queryDto.regionCode,
      customDate: queryDto.customDate,
      customRangeStart: queryDto.customRangeStart,
      customRangeEnd: queryDto.customRangeEnd,
    };

    this.assertCustomRevenueRange(params);

    const cacheKey = buildPulseDashboardHomeCacheKey(
      params.period,
      params.region,
      params.regionCode,
      {
        customDate: params.customDate,
        customRangeStart: params.customRangeStart,
        customRangeEnd: params.customRangeEnd,
      },
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS,
      loadValue: () => this.buildHome(params),
    });
  }

  private async buildHome(
    params: BuildHomeParams,
  ): Promise<PulseDashboardHomeResponseDto> {
    const now = new Date();
    const rangePlan = resolveHomeRevenueRangePlan(params, now);

    const data = await loadPulseHomeRawData(this.prisma, {
      region: params.region,
      regionCode: params.regionCode,
      revenueRange: rangePlan,
      now,
    });

    const { revenueTrend, revenueSummary } = buildHomeRevenueTrend(
      data.membershipOrders,
      rangePlan,
    );

    return {
      online: buildOnlineStats(data.online, now),
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

  /**
   * 自定义日期 / 区间的语义校验。
   *
   * 文本格式由 DTO 正则拦截，这里只处理「格式合法但语义非法」的组合：
   * 单日无法解析、区间两端不成对、开始晚于结束。
   * 非法时抛 400，而不是回落到默认周期静默兜底 —— 否则前端筛选失效会被伪装成「没数据」。
   */
  private assertCustomRevenueRange(params: BuildHomeParams): void {
    const { customDate, customRangeStart, customRangeEnd } = params;

    if (customDate) {
      this.parseShanghaiDateTextOrThrow(customDate, '自定义日期');
      return;
    }

    if (Boolean(customRangeStart) !== Boolean(customRangeEnd)) {
      throw new BadRequestException(
        '自定义区间的开始日期与结束日期必须成对传入',
      );
    }

    if (!customRangeStart || !customRangeEnd) {
      return;
    }

    const startMs = this.parseShanghaiDateTextOrThrow(
      customRangeStart,
      '自定义区间开始日期',
    );
    const endMs = this.parseShanghaiDateTextOrThrow(
      customRangeEnd,
      '自定义区间结束日期',
    );

    if (startMs > endMs) {
      throw new BadRequestException('自定义区间开始日期不能晚于结束日期');
    }
  }

  /** 按上海时区解析日期文本，无法解析时记录并转成 400。 */
  private parseShanghaiDateTextOrThrow(
    dateText: string,
    fieldName: string,
  ): number {
    const parsedMs = parseShanghaiDateText(dateText);
    if (Number.isNaN(parsedMs)) {
      this.logger.warn(`[首页总览] ${fieldName}无法解析：${dateText}`);
      throw new BadRequestException(`${fieldName}不合法`);
    }

    return parsedMs;
  }
}
