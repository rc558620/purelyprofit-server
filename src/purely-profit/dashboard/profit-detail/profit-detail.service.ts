import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import {
  buildCacheRefreshTaskKey,
  buildProfitDetailCacheKey,
  buildProfitReportCacheKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import { Money } from '../../../shared/money.utils';
import { GetProfitDetailQueryDto } from './dto/profit-detail-query.dto';
import type {
  ProfitDetailResponseDto,
  ProfitReportResponseDto,
} from './dto/profit-detail-response.dto';
import {
  safeStreamCsvExport,
} from '../../../shared/stream-export.utils';
import type {
  ProfitDetailQueryInput,
  ProfitMetricsSnapshot,
} from './profit-detail.types';
import {
  aggregateCosts,
  aggregateSales,
  createEmptySalesAggregation,
} from './profit-detail.domain';
import {
  buildEmptyProfitDetailResponse,
  buildEmptyProfitReportResponse,
  buildProfitDetailResponse,
  buildProfitReportResponse,
} from './profit-detail.mapper';
import { fetchProfitRows } from './profit-detail.query';
import {
  buildClampedRanges,
  buildCurrentRange,
  buildPreviousRange,
  buildQueryInput,
} from './profit-detail.utils';

const PROFIT_DETAIL_CACHE_TTL_SECONDS = 120;
const PROFIT_DETAIL_REFRESH_AFTER_MS = 30_000;

@Injectable()
export class ProfitDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getProfitDetail(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitDetailResponseDto> {
    const query = buildQueryInput(queryDto);
    const storeId = await this.resolveStoreId(
      user,
      query.storeId,
      '无权查看该门店利润详情',
    );
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';

    // 导出模式或子账号直接查库，不走缓存
    if (queryDto.export || callerIsSubAccount) {
      const snapshot = await this.buildProfitSnapshot(
        storeId,
        query,
        callerIsSubAccount,
      );
      return snapshot
        ? buildProfitDetailResponse(snapshot, query.period)
        : buildEmptyProfitDetailResponse();
    }

    const cacheKey = buildProfitDetailCacheKey(storeId, query);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PROFIT_DETAIL_CACHE_TTL_SECONDS,
      refreshAfterMs: PROFIT_DETAIL_REFRESH_AFTER_MS,
      loadValue: async () => {
        const snapshot = await this.buildProfitSnapshot(storeId, query, false);
        return snapshot
          ? buildProfitDetailResponse(snapshot, query.period)
          : buildEmptyProfitDetailResponse();
      },
      refreshValue: async () => {
        const snapshot = await this.buildProfitSnapshot(storeId, query, false);
        return snapshot
          ? buildProfitDetailResponse(snapshot, query.period)
          : buildEmptyProfitDetailResponse();
      },
    });
  }

  async getReport(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitReportResponseDto> {
    const query = buildQueryInput(queryDto);
    const storeId = await this.resolveStoreId(
      user,
      query.storeId,
      '无权查看该门店利润报表',
    );
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';

    if (queryDto.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    // 导出模式或子账号直接查库，不走缓存
    if (queryDto.export || callerIsSubAccount) {
      const snapshot = await this.buildProfitSnapshot(
        storeId,
        query,
        callerIsSubAccount,
      );
      return snapshot
        ? buildProfitReportResponse(snapshot)
        : buildEmptyProfitReportResponse();
    }

    const scope = callerIsSubAccount ? 'sub_account' : 'owner';
    const cacheKey = buildProfitReportCacheKey(storeId, {
      ...query,
      scope,
    });
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PROFIT_DETAIL_CACHE_TTL_SECONDS,
      refreshAfterMs: PROFIT_DETAIL_REFRESH_AFTER_MS,
      loadValue: async () => {
        const snapshot = await this.buildProfitSnapshot(storeId, query, false);
        return snapshot
          ? buildProfitReportResponse(snapshot)
          : buildEmptyProfitReportResponse();
      },
      refreshValue: async () => {
        const snapshot = await this.buildProfitSnapshot(storeId, query, false);
        return snapshot
          ? buildProfitReportResponse(snapshot)
          : buildEmptyProfitReportResponse();
      },
    });
  }

  /**
   * 预热利润详情缓存（供 CachePrewarmCycleService 调用）
   */
  async warmDetailCache(
    storeId: number,
    query: Pick<
      GetProfitDetailQueryDto,
      'period' | 'year' | 'customDate' | 'rangeStartDate' | 'rangeEndDate' | 'startTime' | 'endTime'
    >,
  ): Promise<ProfitDetailResponseDto> {
    const cacheKey = buildProfitDetailCacheKey(storeId, query);
    const fullQuery = buildQueryInput(query as GetProfitDetailQueryDto);
    const snapshot = await this.buildProfitSnapshot(storeId, fullQuery, false);
    const data = snapshot
      ? buildProfitDetailResponse(snapshot, fullQuery.period)
      : buildEmptyProfitDetailResponse();
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DETAIL_CACHE_TTL_SECONDS,
      PROFIT_DETAIL_REFRESH_AFTER_MS,
    );
    return data;
  }

  /**
   * 预热利润报表缓存（供 CachePrewarmCycleService 调用）
   */
  async warmReportCache(
    storeId: number,
    query: Pick<
      GetProfitDetailQueryDto,
      'period' | 'year' | 'customDate' | 'rangeStartDate' | 'rangeEndDate' | 'startTime' | 'endTime'
    >,
  ): Promise<ProfitReportResponseDto> {
    const cacheKey = buildProfitReportCacheKey(storeId, query);
    const fullQuery = buildQueryInput(query as GetProfitDetailQueryDto);
    const snapshot = await this.buildProfitSnapshot(storeId, fullQuery, false);
    const data = snapshot
      ? buildProfitReportResponse(snapshot)
      : buildEmptyProfitReportResponse();
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DETAIL_CACHE_TTL_SECONDS,
      PROFIT_DETAIL_REFRESH_AFTER_MS,
    );
    return data;
  }

  /**
   * 流式导出利润报表 CSV，O(1) 内存占用。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<void> {
    const report = await this.getReport(user, queryDto);
    safeStreamCsvExport(
      reply,
      'profit-report.csv',
      ['商品名称', '分类', '销售数量', '总收入', '总利润', '利润率(%)'],
      report.products.map((row) => [
        row.name,
        row.category,
        row.quantity,
        row.totalRevenue,
        row.totalProfit,
        row.profitRate,
      ]),
    );
  }

  private resolveStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      storeId,
      'report:view',
      forbiddenMessage,
    );
  }

  private async buildProfitSnapshot(
    storeId: number,
    query: ProfitDetailQueryInput,
    callerIsSubAccount = false,
  ): Promise<ProfitMetricsSnapshot | null> {
    const currentRange = buildCurrentRange(query);
    const previousRange = buildPreviousRange(query, currentRange);
    const {
      currentRange: clampedCurrentRange,
      previousRange: clampedPreviousRange,
    } = await buildClampedRanges(
      this.platformMembershipAccessService,
      storeId,
      currentRange,
      previousRange,
      callerIsSubAccount,
    );

    if (clampedCurrentRange.empty) {
      return null;
    }

    const { saleRows, costRows } = await fetchProfitRows(
      this.prisma,
      storeId,
      clampedCurrentRange,
      clampedPreviousRange,
    );
    const currentSales = aggregateSales(
      saleRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : aggregateSales(
          saleRows,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );
    const currentCosts = aggregateCosts(
      costRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousCosts = clampedPreviousRange.empty
      ? {
          totalCost: Money.zero(),
          dailyCostMap: new Map<number, Money>(),
          categoryCostMap: new Map(),
        }
      : aggregateCosts(
          costRows,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );
    const netProfit = currentSales.revenue.subtract(currentCosts.totalCost);
    const previousNetProfit = previousSales.revenue.subtract(
      previousCosts.totalCost,
    );

    return {
      currentRange: clampedCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      previousCosts,
      netProfit,
      previousNetProfit,
    };
  }
}
