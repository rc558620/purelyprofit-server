import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildBusinessAnalysisCacheKey,
  buildCacheRefreshTaskKey,
} from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from './dto/business-analysis-response.dto';
import {
  aggregateCosts,
  aggregateSales,
  createEmptyCostAggregation,
  createEmptySalesAggregation,
} from './business-analysis.domain';
import {
  buildBusinessAnalysisResponse,
  buildEmptyAnalysisResponse,
} from './business-analysis.mapper';
import { fetchBusinessAnalysisRows } from './business-analysis.query';
import {
  getPreviousRange,
  resolveCurrentRange,
} from './business-analysis.utils';

const BUSINESS_ANALYSIS_CACHE_TTL_SECONDS = 120;
const BUSINESS_ANALYSIS_REFRESH_AFTER_MS = 30_000;

type BusinessAnalysisCachePayload = {
  generatedAt: number;
  refreshAt: number;
  data: BusinessAnalysisResponseDto;
};

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

    const cacheKey = buildBusinessAnalysisCacheKey(storeId, query);
    const cachedPayload =
      await this.redisService.getJson<BusinessAnalysisCachePayload>(cacheKey);

    if (cachedPayload !== null) {
      this.scheduleAnalysisRefresh(
        cacheKey,
        storeId,
        query,
        cachedPayload.refreshAt,
      );
      return cachedPayload.data;
    }

    return this.refreshAnalysisCache(cacheKey, storeId, query, callerIsSubAccount);
  }

  async warmAnalysisCache(
    storeId: number,
    query: Pick<
      GetBusinessAnalysisQueryDto,
      'period' | 'startTime' | 'endTime'
    >,
  ): Promise<BusinessAnalysisResponseDto> {
    const cacheKey = buildBusinessAnalysisCacheKey(storeId, query);
    return this.refreshAnalysisCache(cacheKey, storeId, query, false);
  }

  private scheduleAnalysisRefresh(
    cacheKey: string,
    storeId: number,
    query: GetBusinessAnalysisQueryDto,
    refreshAt: number,
  ): void {
    if (refreshAt > Date.now()) {
      return;
    }

    this.redisService.runBackgroundRefresh(
      buildCacheRefreshTaskKey(cacheKey),
      async () => {
        await this.refreshAnalysisCache(cacheKey, storeId, query, false);
      },
    );
  }

  private async refreshAnalysisCache(
    cacheKey: string,
    storeId: number,
    query: GetBusinessAnalysisQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<BusinessAnalysisResponseDto> {
    const data = await this.buildAnalysis(storeId, query, callerIsSubAccount);
    const now = Date.now();

    await this.redisService.setJson(
      cacheKey,
      {
        generatedAt: now,
        refreshAt: now + BUSINESS_ANALYSIS_REFRESH_AFTER_MS,
        data,
      } satisfies BusinessAnalysisCachePayload,
      BUSINESS_ANALYSIS_CACHE_TTL_SECONDS,
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

    const { saleItems, costRows } = await fetchBusinessAnalysisRows(
      this.prisma,
      storeId,
      clampedCurrentRange,
      clampedPreviousRange,
    );

    const currentSales = aggregateSales(
      saleItems,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousSales = clampedPreviousRange.empty
      ? createEmptySalesAggregation()
      : aggregateSales(
          saleItems,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );
    const currentCosts = aggregateCosts(
      costRows,
      clampedCurrentRange.start,
      clampedCurrentRange.end,
    );
    const previousCosts = clampedPreviousRange.empty
      ? createEmptyCostAggregation()
      : aggregateCosts(
          costRows,
          clampedPreviousRange.start,
          clampedPreviousRange.end,
        );

    return buildBusinessAnalysisResponse({
      currentRange: clampedCurrentRange,
      currentSales,
      previousSales,
      currentCosts,
      previousCosts,
    });
  }
}
