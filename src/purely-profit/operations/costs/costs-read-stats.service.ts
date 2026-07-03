import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money } from '../../../shared/money.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildCostsStatsCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { CostRecordStatsQueryDto } from './dto/costs-query.dto';
import type { CostStatsResponseDto } from './dto/costs-response.dto';
import { buildEmptyCostStatsResponse } from './costs.domain';
import { buildHistoryAwareCostRecordWhere } from './costs.query';
import {
  COSTS_STATS_CACHE_TTL_SECONDS,
  COSTS_STATS_REFRESH_AFTER_MS,
  calculatePreviousPeriodChange,
  resolveCallerIsSubAccount,
} from './costs-read.shared';

@Injectable()
export class CostsReadStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getStats(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本统计',
    );

    if (storeId === null) {
      return buildEmptyCostStatsResponse();
    }

    const callerIsSubAccount = resolveCallerIsSubAccount(user);

    // 子账号直接查库，不走缓存
    if (callerIsSubAccount) {
      return this.buildStats(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsStatsCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_STATS_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_STATS_REFRESH_AFTER_MS,
      loadValue: () => this.buildStats(storeId, query, false),
      refreshValue: () => this.buildStats(storeId, query, false),
    });
  }

  /**
   * 预热成本统计缓存（供 CachePrewarmCycleService 调用）
   */
  async warmStatsCache(
    storeId: number,
    query: Pick<
      CostRecordStatsQueryDto,
      'period' | 'typeFilter' | 'customDate' | 'rangeStartDate' | 'rangeEndDate'
    >,
  ): Promise<CostStatsResponseDto> {
    const cacheKey = buildCostsStatsCacheKey(storeId, query);
    const data = await this.buildStats(storeId, query, false);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      COSTS_STATS_CACHE_TTL_SECONDS,
      COSTS_STATS_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildStats(
    storeId: number,
    query: CostRecordStatsQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<CostStatsResponseDto> {
    const currentWhere = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (currentWhere === null) {
      return buildEmptyCostStatsResponse();
    }

    const currentAggregate = await this.prisma.costRecord.aggregate({
      where: currentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const currentTypeRows = await this.prisma.costRecord.groupBy({
      by: ['type'],
      where: currentWhere,
      _sum: { amount: true },
    });

    const total = Money.fromDbCents(
      Number(currentAggregate._sum.amount ?? 0),
    ).toOutputYuan();
    const fixed = Money.fromDbCents(
      Number(
        currentTypeRows.find((record) => record.type === 'fixed')?._sum
          .amount ?? 0,
      ),
    ).toOutputYuan();
    const variable = Money.fromDbCents(
      Number(
        currentTypeRows.find((record) => record.type === 'variable')?._sum
          .amount ?? 0,
      ),
    ).toOutputYuan();
    const compareLastPeriod = await calculatePreviousPeriodChange(
      this.prisma,
      this.platformMembershipAccessService,
      storeId,
      query,
      total,
      callerIsSubAccount,
    );

    return {
      total,
      fixed,
      variable,
      compareLastPeriod,
      recordCount: currentAggregate._count._all,
    };
  }
}
