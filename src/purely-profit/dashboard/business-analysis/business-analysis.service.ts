import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildBusinessAnalysisCacheKey,
  buildCacheRefreshTaskKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import {
  buildCostAggregation,
  buildSalesAggregation,
  createEmptyCostAggregation,
  createEmptySalesAggregation,
} from './business-analysis.domain';
import {
  buildBusinessAnalysisResponse,
  buildEmptyAnalysisResponse,
} from './business-analysis.mapper';
import { fetchBusinessAnalysisMetrics } from './business-analysis.query';
import {
  getPreviousRange,
  resolveCurrentRange,
} from './business-analysis.utils';

const BUSINESS_ANALYSIS_CACHE_TTL_SECONDS = 120;
const BUSINESS_ANALYSIS_REFRESH_AFTER_MS = 30_000;

function normalizeBusinessAnalysisQuery(
  query: GetBusinessAnalysisQueryDto,
): GetBusinessAnalysisQueryDto {
  const rawPeriod = (query as { period?: string }).period;
  if (
    rawPeriod !== 'all' ||
    query.startTime === undefined ||
    query.endTime === undefined
  ) {
    return query;
  }

  return {
    ...query,
    period: 'custom_range',
  };
}

@Injectable()
export class BusinessAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getAnalysis(
    user: AuthenticatedUser,
    query: GetBusinessAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店经营分析',
    );
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';

    return this.getAnalysisByStoreId(storeId, query, callerIsSubAccount);
  }

  async getAnalysisByStoreId(
    storeId: number,
    query: GetBusinessAnalysisQueryDto,
    callerIsSubAccount = false,
  ): Promise<BusinessAnalysisResponseDto> {
    const normalizedQuery = normalizeBusinessAnalysisQuery(query);

    if (normalizedQuery.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
      return this.buildAnalysis(storeId, normalizedQuery, callerIsSubAccount);
    }

    const cacheKey = buildBusinessAnalysisCacheKey(storeId, normalizedQuery);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: BUSINESS_ANALYSIS_CACHE_TTL_SECONDS,
      refreshAfterMs: BUSINESS_ANALYSIS_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildAnalysis(storeId, normalizedQuery, callerIsSubAccount),
      refreshValue: () => this.buildAnalysis(storeId, normalizedQuery, false),
    });
  }

  async warmAnalysisCache(
    storeId: number,
    query: Pick<
      GetBusinessAnalysisQueryDto,
      'period' | 'startTime' | 'endTime'
    >,
  ): Promise<BusinessAnalysisResponseDto> {
    const normalizedQuery = normalizeBusinessAnalysisQuery(
      query as GetBusinessAnalysisQueryDto,
    );
    const cacheKey = buildBusinessAnalysisCacheKey(storeId, normalizedQuery);
    const data = await this.buildAnalysis(storeId, normalizedQuery, false);
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      BUSINESS_ANALYSIS_CACHE_TTL_SECONDS,
      BUSINESS_ANALYSIS_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildAnalysis(
    storeId: number,
    query: GetBusinessAnalysisQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<BusinessAnalysisResponseDto> {
    const currentRange = resolveCurrentRange(query);
    const previousRange = getPreviousRange(
      currentRange.start,
      currentRange.end,
    );
    const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
      this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
        callerIsSubAccount,
      ),
      this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        previousRange,
        callerIsSubAccount,
      ),
    ]);

    if (clampedCurrentRange.empty) {
      return buildEmptyAnalysisResponse();
    }

    const metricsRows = await fetchBusinessAnalysisMetrics(
      this.prisma,
      storeId,
      clampedCurrentRange,
      clampedPreviousRange,
    );
    const currentSales = buildSalesAggregation({
      revenue: Number(metricsRows.salesSummaryRow.currentRevenue ?? 0),
      orderCount: metricsRows.salesSummaryRow.currentOrderCount,
      dailyRows: metricsRows.salesDailyRows,
      categoryRows: metricsRows.salesCategoryRows,
      rankRows: metricsRows.salesRankRows,
    });
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : buildSalesAggregation({
          revenue: Number(metricsRows.salesSummaryRow.previousRevenue ?? 0),
          orderCount: metricsRows.salesSummaryRow.previousOrderCount,
        });
    const currentCosts = buildCostAggregation({
      totalCost: Number(metricsRows.costSummaryRow.currentTotalCost ?? 0),
      dailyRows: metricsRows.costDailyRows,
      bucketRows: metricsRows.costBucketRows,
    });
    const previousCosts = clampedPreviousRange.empty
      ? createEmptyCostAggregation()
      : buildCostAggregation({
          totalCost: Number(metricsRows.costSummaryRow.previousTotalCost ?? 0),
        });

    return buildBusinessAnalysisResponse({
      currentRange: clampedCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      previousCosts,
    });
  }
}
