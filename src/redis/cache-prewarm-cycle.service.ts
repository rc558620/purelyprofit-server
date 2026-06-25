import { Injectable, Logger } from '@nestjs/common';
import { recordCachePrewarmCycle } from '../observability';
import { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import { MarketingOverviewService } from '../purely-profit/marketing/marketing-overview.service';
import { MembersService } from '../purely-profit/member/members/members.service';
import type {
  CachePrewarmCategoryConfig,
  CachePrewarmCategoryResultsMap,
  CachePrewarmCycleMetrics,
} from './cache-prewarm.types';
import { createCachePrewarmCategoryConfigs } from './cache-prewarm.config';
import {
  buildCachePrewarmCycleSummaryLog,
  shouldLogCachePrewarmCycleSummary,
} from './cache-prewarm.log';
import {
  buildCachePrewarmCategoryResultsMap,
  buildCachePrewarmCycleMetrics,
  buildFailedCachePrewarmCycleMetrics,
} from './cache-prewarm.utils';
import { RedisService } from './redis.service';

export type CachePrewarmCycleRunInput = {
  cycleId: number;
  batchSize: number;
  concurrency: number;
  logEnabled: boolean;
  logSampleEvery: number;
  slowCycleThresholdMs: number;
};

@Injectable()
export class CachePrewarmCycleService {
  private readonly logger = new Logger(CachePrewarmCycleService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly dashboardHomeService: DashboardHomeService,
    private readonly businessAnalysisService: BusinessAnalysisService,
    private readonly financeOverviewService: FinanceOverviewService,
    private readonly marketingOverviewService: MarketingOverviewService,
    private readonly membersService: MembersService,
  ) {}

  async runCycle(input: CachePrewarmCycleRunInput): Promise<void> {
    const startedAt = Date.now();

    try {
      const categoryConfigs = this.createCategoryConfigs();
      const cacheKeysByCategory = await this.scanCategoryKeys(
        categoryConfigs,
        input.batchSize,
      );
      const results = await this.prewarmCategories(
        categoryConfigs,
        cacheKeysByCategory,
        input.concurrency,
      );
      const metrics = buildCachePrewarmCycleMetrics(
        Date.now() - startedAt,
        results,
      );

      recordCachePrewarmCycle(metrics);
      this.logCycleSummary(input, metrics);
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      recordCachePrewarmCycle(buildFailedCachePrewarmCycleMetrics(durationMs));
      this.logger.error('[cache-prewarm] cycle failed', error);
    }
  }

  private createCategoryConfigs(): readonly CachePrewarmCategoryConfig[] {
    return createCachePrewarmCategoryConfigs({
      dashboardHomeService: this.dashboardHomeService,
      businessAnalysisService: this.businessAnalysisService,
      financeOverviewService: this.financeOverviewService,
      marketingOverviewService: this.marketingOverviewService,
      membersService: this.membersService,
    });
  }

  private async scanCategoryKeys(
    categoryConfigs: readonly CachePrewarmCategoryConfig[],
    batchSize: number,
  ): Promise<readonly string[][]> {
    return Promise.all(
      categoryConfigs.map((config) =>
        this.redisService.scanKeysByPattern(config.scanPattern(), batchSize),
      ),
    );
  }

  private async prewarmCategories(
    categoryConfigs: readonly CachePrewarmCategoryConfig[],
    cacheKeysByCategory: readonly string[][],
    concurrency: number,
  ): Promise<CachePrewarmCategoryResultsMap> {
    const entries = await Promise.all(
      categoryConfigs.map(async (config, index) => {
        const cacheKeys = cacheKeysByCategory[index] ?? [];
        return [
          config.category,
          await config.prewarm(cacheKeys, { concurrency }),
        ] as const;
      }),
    );

    return buildCachePrewarmCategoryResultsMap(entries);
  }

  private logCycleSummary(
    input: CachePrewarmCycleRunInput,
    metrics: CachePrewarmCycleMetrics,
  ): void {
    if (!input.logEnabled) {
      return;
    }

    if (
      !shouldLogCachePrewarmCycleSummary(
        input.cycleId,
        metrics,
        input.logSampleEvery,
        input.slowCycleThresholdMs,
      )
    ) {
      return;
    }

    this.logger.log(buildCachePrewarmCycleSummaryLog(input.cycleId, metrics));
  }
}
