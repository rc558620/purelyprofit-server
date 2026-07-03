import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildPulseDashboardRevenueDetailCacheKey } from '../pulse.cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { RedisService } from '../../redis/redis.service';
import {
  DEFAULT_REVENUE_DETAIL_PERIOD,
  EMPTY_REGION_PLACEHOLDER,
  REVENUE_DETAIL_RANGE_PERIOD,
  REVENUE_DETAIL_SINGLE_DAY_PERIOD,
} from './dashboard.constants';
import { calculatePercentChange } from './dashboard-math.utils';
import {
  buildRevenueTrend,
  buildRevenueTypeDistribution,
  calcRevenuePeakAmount,
  formatHourMinute,
  mapRevenuePlanLabel,
  normalizeRegionValues,
} from './dashboard-revenue.utils';
import type {
  DashboardRevenueDetailOrderRow,
  DashboardRevenueTypeLabelRow,
} from './dashboard.types';
import {
  buildDateRange,
  buildHomeRevenueRange,
  buildPreviousSequentialRange,
  buildSingleDayRange,
  DAY_MS,
  getInclusiveDayCount,
  isTimeInRange,
  type TimeRange,
} from './dashboard-time.utils';
import type {
  GetPulseRevenueDetailQueryDto,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';
import type { PulseRevenueDetailResponseDto } from './dto/pulse-dashboard-revenue-detail.response.dto';

const PULSE_DASHBOARD_REVENUE_DETAIL_CACHE_TTL_SECONDS = 20;
const PULSE_DASHBOARD_REVENUE_DETAIL_REFRESH_AFTER_MS = 8_000;

@Injectable()
export class PulseDashboardRevenueDetailService {
  private readonly logger = new Logger(PulseDashboardRevenueDetailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getRevenueDetail(
    _user: AuthenticatedUser,
    queryDto: GetPulseRevenueDetailQueryDto,
  ): Promise<PulseRevenueDetailResponseDto> {
    const cacheKey = buildPulseDashboardRevenueDetailCacheKey({
      period: queryDto.period,
      date: queryDto.date,
      startDate: queryDto.startDate,
      endDate: queryDto.endDate,
      regionValues: queryDto.regionValues,
      regionCode: queryDto.regionCode,
      provinceCode: queryDto.provinceCode,
      cityCode: queryDto.cityCode,
      districtCode: queryDto.districtCode,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_DASHBOARD_REVENUE_DETAIL_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_DASHBOARD_REVENUE_DETAIL_REFRESH_AFTER_MS,
      loadValue: () => this.buildRevenueDetail(queryDto),
    });
  }

  private async buildRevenueDetail(
    queryDto: GetPulseRevenueDetailQueryDto,
  ): Promise<PulseRevenueDetailResponseDto> {
    const now = new Date();
    const { currentRange, previousRange, displayPeriod } =
      this.resolveRevenueDetailRanges(queryDto, now);
    const lowerBound = Math.min(previousRange.start, currentRange.start);
    const upperBound = Math.max(previousRange.end, currentRange.end);

    const rawOrders: DashboardRevenueDetailOrderRow[] =
      await this.prisma.storeMembershipOrder.findMany({
        where: {
          status: 'paid',
          createdAt: {
            gte: new Date(lowerBound),
            lte: new Date(upperBound),
          },
        },
        select: {
          id: true,
          storeId: true,
          amount: true,
          planId: true,
          planName: true,
          createdAt: true,
          store: {
            select: {
              name: true,
              address: true,
              owner: {
                select: {
                  name: true,
                  realName: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

    const regionFilters = this.extractRevenueRegionFilters(queryDto);
    const storeIds = Array.from(
      new Set(rawOrders.map((order) => order.storeId)),
    );
    const regionCodeMap = await this.readRevenueRegionCodeMap(storeIds);
    const orders = rawOrders.filter((order) =>
      this.matchesRevenueRegion(
        regionCodeMap.get(order.storeId) ?? [],
        regionFilters,
      ),
    );

    const previousOrders = orders.filter((order) =>
      isTimeInRange(order.createdAt, previousRange),
    );
    const currentOrders = orders.filter((order) =>
      isTimeInRange(order.createdAt, currentRange),
    );
    const currentTotal = currentOrders.reduce(
      (sum, order) => sum + order.amount,
      0,
    );
    const previousTotal = previousOrders.reduce(
      (sum, order) => sum + order.amount,
      0,
    );
    const revenueTypeRows: DashboardRevenueTypeLabelRow[] = currentOrders.map(
      (order) => ({
        typeLabel: mapRevenuePlanLabel(order.planId, order.planName),
      }),
    );

    return {
      revenueTrend: buildRevenueTrend(currentOrders, displayPeriod),
      revenueSummary: {
        total: currentTotal,
        avg: Math.round(currentTotal / getInclusiveDayCount(currentRange)),
        growth:
          calculatePercentChange(currentTotal, previousTotal, {
            fallback: 0,
          }) ?? 0,
        orders: currentOrders.length,
        peak: calcRevenuePeakAmount(currentOrders),
      },
      revenueTypeBreakdown: buildRevenueTypeDistribution(revenueTypeRows),
      records: currentOrders
        .slice()
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .map((order) => ({
          id: String(order.id),
          user:
            order.store.owner.realName?.trim() ||
            order.store.owner.name?.trim() ||
            order.store.name,
          type: mapRevenuePlanLabel(order.planId, order.planName),
          amount: order.amount,
          region: this.buildRevenueRegionText(
            regionCodeMap.get(order.storeId) ?? [],
            order.store.address,
          ),
          time: formatHourMinute(order.createdAt),
        })),
      totalRecords: currentOrders.length,
      generatedAt: now.getTime(),
    };
  }

  private resolveRevenueDetailRanges(
    queryDto: GetPulseRevenueDetailQueryDto,
    now: Date,
  ): {
    currentRange: TimeRange;
    previousRange: TimeRange;
    displayPeriod: PulseHomeRevenuePeriodValue;
  } {
    if (queryDto.date) {
      const currentRange = buildSingleDayRange(queryDto.date);
      return {
        currentRange,
        previousRange: {
          start: currentRange.start - DAY_MS,
          end: currentRange.end - DAY_MS,
        },
        displayPeriod: REVENUE_DETAIL_SINGLE_DAY_PERIOD,
      };
    }

    if (queryDto.startDate && queryDto.endDate) {
      const currentRange = buildDateRange(queryDto.startDate, queryDto.endDate);
      return {
        currentRange,
        previousRange: buildPreviousSequentialRange(currentRange),
        displayPeriod: REVENUE_DETAIL_RANGE_PERIOD,
      };
    }

    const displayPeriod = queryDto.period ?? DEFAULT_REVENUE_DETAIL_PERIOD;
    const currentRange = buildHomeRevenueRange(displayPeriod, now);
    return {
      currentRange,
      previousRange: buildPreviousSequentialRange(currentRange, displayPeriod),
      displayPeriod,
    };
  }

  private extractRevenueRegionFilters(
    queryDto: GetPulseRevenueDetailQueryDto,
  ): string[] {
    const filters = [
      queryDto.districtCode,
      queryDto.cityCode,
      queryDto.provinceCode,
      queryDto.regionCode,
      ...(queryDto.regionValues?.split(',') ?? []),
    ]
      .map((item) => item?.trim() ?? '')
      .filter(Boolean);

    return Array.from(new Set(filters));
  }

  private async readRevenueRegionCodeMap(
    storeIds: number[],
  ): Promise<Map<number, string[]>> {
    if (storeIds.length === 0) {
      return new Map();
    }

    // 使用 mgetJson 一次批量获取所有门店缓存，替代 N 次 GET
    const keys = storeIds.map((id) => `stores:profile:${id}`);
    const rawValues = await this.redisService.mgetJson<{ region?: unknown }>(
      keys,
    );

    const result = new Map<number, string[]>();
    for (let i = 0; i < storeIds.length; i++) {
      const storeId = storeIds[i];
      const parsed = rawValues[i];
      try {
        result.set(storeId, parsed ? normalizeRegionValues(parsed.region) : []);
      } catch (error: unknown) {
        this.logger.warn(
          `[DashboardRevenueDetailService] 解析门店 ${storeId} 区域缓存失败: ${error instanceof Error ? error.message : String(error)}`,
        );
        result.set(storeId, []);
      }
    }

    return result;
  }

  private buildRevenueRegionText(
    regionCodes: string[],
    address: string | null,
  ): string {
    if (regionCodes.length > 0) {
      return regionCodes.join(' · ');
    }

    return address?.trim() || EMPTY_REGION_PLACEHOLDER;
  }

  private matchesRevenueRegion(
    regionCodes: string[],
    filters: string[],
  ): boolean {
    if (filters.length === 0) {
      return true;
    }

    return filters.some((filter) => regionCodes.includes(filter));
  }
}
