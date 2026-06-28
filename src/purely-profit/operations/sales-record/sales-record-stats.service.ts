import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money, calcPercentChangeWithFallback } from '../../../shared/money.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSalesStatsCacheKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import type {
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import {
  aggregateOrderStats,
  type SalesStatsAggregation,
} from './sales-record.query';
import {
  buildEmptySalesStats,
  toSalesRecordQueryInput,
} from './sales-record-read.utils';
import { buildCurrentRange, buildPreviousRange } from './sales-record.utils';

const SALES_STATS_CACHE_TTL_SECONDS = 60;
const SALES_STATS_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class SalesRecordStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getStats(
    user: AuthenticatedUser,
    query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店销售统计',
    );

    if (storeId === null) {
      return buildEmptySalesStats();
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const cacheKey = buildSalesStatsCacheKey(storeId, {
      scope: callerIsSubAccount ? 'sub_account' : 'owner',
      period: query.period,
      year: query.year,
      customDate:
        query.customDate !== undefined ? String(query.customDate) : undefined,
      rangeStartDate:
        query.rangeStartDate !== undefined
          ? String(query.rangeStartDate)
          : undefined,
      rangeEndDate:
        query.rangeEndDate !== undefined
          ? String(query.rangeEndDate)
          : undefined,
    });

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SALES_STATS_CACHE_TTL_SECONDS,
      refreshAfterMs: SALES_STATS_REFRESH_AFTER_MS,
      loadValue: () => this.buildStats(storeId, callerIsSubAccount, query),
      refreshValue: () => this.buildStats(storeId, false, query),
    });
  }

  private async buildStats(
    storeId: number,
    callerIsSubAccount: boolean,
    query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    const queryInput = toSalesRecordQueryInput(query);
    const currentRange = buildCurrentRange(queryInput);
    const previousRange = buildPreviousRange(queryInput, currentRange);
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
        callerIsSubAccount,
      );
    const clampedPreviousRange = previousRange
      ? await this.platformMembershipAccessService.clampHistoryRange(
          storeId,
          previousRange,
          callerIsSubAccount,
        )
      : null;

    if (clampedCurrentRange.empty) {
      return buildEmptySalesStats();
    }

    const [currentStats, previousStats] = await Promise.all([
      aggregateOrderStats(this.prisma, storeId, {
        start: clampedCurrentRange.start,
        end: clampedCurrentRange.end,
      }),
      clampedPreviousRange && !clampedPreviousRange.empty
        ? aggregateOrderStats(this.prisma, storeId, {
            start: clampedPreviousRange.start,
            end: clampedPreviousRange.end,
          })
        : Promise.resolve<SalesStatsAggregation>({
            totalRevenue: 0,
            totalProfit: 0,
            orderCount: 0,
          }),
    ]);

    return {
      totalRevenue: currentStats.totalRevenue,
      totalProfit: currentStats.totalProfit,
      orderCount: currentStats.orderCount,
      avgOrderValue:
        currentStats.orderCount > 0
          ? Money.fromInputYuan(currentStats.totalRevenue)
              .divide(currentStats.orderCount)
              .toOutputYuan()
          : 0,
      compareLastPeriod:
        clampedPreviousRange &&
        !clampedPreviousRange.empty &&
        previousStats.totalRevenue > 0
          ? calcPercentChangeWithFallback(
              currentStats.totalRevenue,
              previousStats.totalRevenue,
            )
          : null,
    };
  }
}
