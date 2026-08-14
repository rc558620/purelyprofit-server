import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildBusinessAnalysisCacheKey,
  buildCacheRefreshTaskKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import type { BusinessAnalysisAccessibleRange } from './business-analysis.types';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';
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
const DAY_MS = 86_400_000;
// 与 business-analysis.mapper 中的 MAX_TREND_DAYS 保持一致：趋势图最多覆盖 366 天
// （完整自然年）。超过该跨度的自定义区间，在聚合（heroSummary 总额）与日趋势
// （dailyTrend）两端统一裁剪到末尾窗口，避免口径不一致。
const MAX_TREND_DAYS = 366;

/**
 * 将区间裁剪到末尾最多 MAX_TREND_DAYS 天，使 heroSummary 汇总与
 * dailyTrend 使用同一窗口，避免长自定义区间下总额与趋势口径不一致。
 */
function clampRangeToMaxTrendDays(
  range: BusinessAnalysisAccessibleRange,
): BusinessAnalysisAccessibleRange {
  const spanDays = Math.floor((range.end - range.start) / DAY_MS) + 1;
  if (spanDays <= MAX_TREND_DAYS) {
    return range;
  }
  return {
    ...range,
    start: range.end - (MAX_TREND_DAYS - 1) * DAY_MS,
  };
}

@Injectable()
export class BusinessAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
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
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
      return this.buildAnalysis(storeId, query, callerIsSubAccount);
    }

    // 子账号不受历史窗口裁剪，缓存中老板裁剪后的数据对子账号不正确，
    // 因此子账号直接查库以保证数据完整性；老板走缓存加速。
    if (callerIsSubAccount) {
      return this.buildAnalysis(storeId, query, true);
    }

    const cacheKey = buildBusinessAnalysisCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: BUSINESS_ANALYSIS_CACHE_TTL_SECONDS,
      refreshAfterMs: BUSINESS_ANALYSIS_REFRESH_AFTER_MS,
      loadValue: () => this.buildAnalysis(storeId, query, false),
      refreshValue: () => this.buildAnalysis(storeId, query, false),
    });
  }

  async warmAnalysisCache(
    storeId: number,
    query: Pick<
      GetBusinessAnalysisQueryDto,
      'period' | 'startTime' | 'endTime'
    >,
  ): Promise<BusinessAnalysisResponseDto> {
    const cacheKey = buildBusinessAnalysisCacheKey(storeId, query);
    const data = await this.buildAnalysis(
      storeId,
      query as GetBusinessAnalysisQueryDto,
      false,
    );
    await this.refreshableCache.writeRefreshableJson(
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
    const rawCurrentRange = resolveCurrentRange(query);
    // 先按会员历史窗口裁剪当前区间（老板受窗口限制，子账号不受限）。
    const windowClampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        rawCurrentRange,
        callerIsSubAccount,
      );

    if (windowClampedCurrentRange.empty) {
      return buildEmptyAnalysisResponse();
    }

    // 趋势图最多覆盖 MAX_TREND_DAYS 天：先把当前区间裁剪到末尾窗口，
    // 使 heroSummary 汇总与 dailyTrend 口径一致。
    // 上一区间基于「裁剪后的当前区间」推算，保证环比为等长相邻窗口，
    // 修复会员历史窗口落在上一周期、导致当前/上一周期长度错位的缺陷。
    const effectiveCurrentRange = clampRangeToMaxTrendDays(
      windowClampedCurrentRange,
    );
    const rawPreviousRange = getPreviousRange(
      effectiveCurrentRange.start,
      effectiveCurrentRange.end,
    );
    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        rawPreviousRange,
        callerIsSubAccount,
      );

    const metricsRows = await fetchBusinessAnalysisMetrics(
      this.prisma,
      storeId,
      effectiveCurrentRange,
      clampedPreviousRange,
    );
    const currentSales = buildSalesAggregation({
      revenue: Number(metricsRows.salesSummaryRow.currentRevenue ?? 0),
      profit: Number(metricsRows.salesSummaryRow.currentProfit ?? 0),
      orderCount: metricsRows.salesSummaryRow.currentOrderCount,
      dailyRows: metricsRows.salesDailyRows,
      categoryRows: metricsRows.salesCategoryRows,
      rankRows: metricsRows.salesRankRows,
    });
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : buildSalesAggregation({
          revenue: Number(metricsRows.salesSummaryRow.previousRevenue ?? 0),
          profit: Number(metricsRows.salesSummaryRow.previousProfit ?? 0),
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
      currentRange: effectiveCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      previousCosts,
    });
  }

  /**
   * 流式导出经营分析 CSV，O(1) 内存占用。
   * 导出商品利润排行数据。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: GetBusinessAnalysisQueryDto,
  ): Promise<void> {
    const report = await this.getAnalysis(user, query);
    safeStreamCsvExport(
      reply,
      'business-analysis.csv',
      ['商品名称', '分类', '利润率(%)', '总利润', '总收入', '销量'],
      report.rankProducts.map((row) => [
        row.name,
        row.category,
        row.profitRate,
        row.totalProfit,
        row.totalRevenue,
        row.quantity,
      ]),
    );
  }
}
