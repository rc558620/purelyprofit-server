import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  DEFAULT_REVENUE_DETAIL_PERIOD,
  EMPTY_REGION_PLACEHOLDER,
  REVENUE_DETAIL_RANGE_PERIOD,
  REVENUE_DETAIL_SINGLE_DAY_PERIOD,
} from './dashboard.constants';
import {
  calculatePercentChange,
  convertFenToYuan,
} from './dashboard-math.utils';
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
import type { PulseRevenueDetailResponseDto } from './dto/pulse-dashboard-response.dto';

@Injectable()
export class PulseDashboardRevenueDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getRevenueDetail(
    _user: AuthenticatedUser,
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
    const storeIds = Array.from(new Set(rawOrders.map((order) => order.storeId)));
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
      revenueTrend: buildRevenueTrend(
        currentOrders,
        displayPeriod,
        convertFenToYuan,
      ),
      revenueSummary: {
        total: currentTotal,
        avg: Math.round(currentTotal / getInclusiveDayCount(currentRange)),
        growth:
          calculatePercentChange(currentTotal, previousTotal, { fallback: 0 }) ?? 0,
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
      previousRange: buildPreviousSequentialRange(currentRange),
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
    const entries = await Promise.all(
      storeIds.map(async (storeId) => {
        try {
          const raw = await this.redisService.get(`stores:profile:${storeId}`);
          if (!raw) {
            return [storeId, [] as string[]] as const;
          }

          const parsed = JSON.parse(raw) as { region?: unknown };
          return [storeId, normalizeRegionValues(parsed.region)] as const;
        } catch {
          return [storeId, [] as string[]] as const;
        }
      }),
    );

    return new Map(entries);
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

  private matchesRevenueRegion(regionCodes: string[], filters: string[]): boolean {
    if (filters.length === 0) {
      return true;
    }

    return filters.some((filter) => regionCodes.includes(filter));
  }
}
