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
import { RedisService } from '../../../redis/redis.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import {
  safeStreamCsvExport,
} from '../../../shared/stream-export.utils';
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
    return this.redisService.getOrLoadRefreshableJson({
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
