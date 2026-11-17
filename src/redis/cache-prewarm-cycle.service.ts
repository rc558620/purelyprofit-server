import { Injectable, Logger } from '@nestjs/common';
import { recordCachePrewarmCycle } from '../observability';
import { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import { ProfitDetailService } from '../purely-profit/dashboard/profit-detail/profit-detail.service';
import { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import { MarketingOverviewService } from '../purely-profit/marketing/marketing-overview.service';
import { MembersService } from '../purely-profit/member/members/members.service';
import { CostsReadService } from '../purely-profit/operations/costs/costs-read.service';
import type {
  CachePrewarmCategoryConfig,
  CachePrewarmCategoryResultsMap,
  CachePrewarmCycleMetrics,
} from './cache-prewarm.types';
import { createCachePrewarmCategoryConfigs } from './cache-prewarm.config';
import { selectCachePrewarmKeys } from './cache-prewarm.selection';
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

/** 单次 pipeline 读取 OBJECT IDLETIME 的 key 数：兼顾往返次数与单包体积 */
const IDLETIME_PIPELINE_CHUNK = 200;

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
    private readonly profitDetailService: ProfitDetailService,
    private readonly costsReadService: CostsReadService,
  ) {}

  async runCycle(input: CachePrewarmCycleRunInput): Promise<void> {
    if (!this.redisService.isReady()) {
      return;
    }

    const startedAt = Date.now();

    try {
      const categoryConfigs = this.createCategoryConfigs();
      const cacheKeysByCategory = await this.scanCategoryKeys(
        categoryConfigs,
        input.batchSize,
      );
      const results = await this.prewarmCategories(
        categoryConfigs,
        await this.selectCategoryKeys(categoryConfigs, cacheKeysByCategory),
        input.concurrency,
      );
      const metrics = buildCachePrewarmCycleMetrics(
        Date.now() - startedAt,
        results,
      );

      recordCachePrewarmCycle(metrics);
      this.logCycleSummary(input, metrics);
    } catch (error: unknown) {
      if (this.redisService.isConnectionClosedError(error)) {
        return;
      }

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
      profitDetailService: this.profitDetailService,
      costsReadService: this.costsReadService,
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

  /**
   * 按门店配额 + 最近访问收敛本轮预热集合（仅对声明了 selection 的类目生效）。
   *
   * 未声明策略的类目原样返回，行为与改造前完全一致；因此本收敛是逐类目 opt-in，
   * 不会因为财务报表 key 组合爆炸的治理顺带改变其它模块的预热节奏。
   */
  private async selectCategoryKeys(
    categoryConfigs: readonly CachePrewarmCategoryConfig[],
    cacheKeysByCategory: readonly string[][],
  ): Promise<readonly string[][]> {
    return Promise.all(
      categoryConfigs.map((config, index) =>
        this.selectCategoryKeysOfCategory(
          config,
          cacheKeysByCategory[index] ?? [],
        ),
      ),
    );
  }

  private async selectCategoryKeysOfCategory(
    config: CachePrewarmCategoryConfig,
    cacheKeys: string[],
  ): Promise<string[]> {
    const policy = config.selection;
    const resolveStoreId = config.resolveStoreId;
    if (!policy || !resolveStoreId || cacheKeys.length === 0) {
      return cacheKeys;
    }

    const idleSecondsByKey = await this.readIdleSeconds(cacheKeys);
    const selection = selectCachePrewarmKeys({
      cacheKeys,
      resolveStoreId,
      policy,
      idleSecondsByKey,
    });

    if (selection.evictedForIdle.length > 0) {
      await this.redisService.delMany(selection.evictedForIdle);
    }

    this.logger.debug(
      `[cache-prewarm] selection ${config.category}: scanned=${cacheKeys.length} selected=${selection.selected.length} evicted=${selection.evictedForIdle.length} overCap=${selection.droppedByStoreCap}`,
    );

    return selection.selected;
  }

  /**
   * 批量读取 key 的空闲秒数（OBJECT IDLETIME，O(1)/key，一次 pipeline 往返）。
   *
   * 该值来自 Redis 自身的访问记录，不需要在读热路径上额外写「最近访问」标记，
   * 避免了为了预热收敛反过来给每一次业务读都加一次 Redis 写。
   * pipeline 失败时按「已读到的部分」返回，未读到的 key 由选择器视为刚访问过，
   * 宁可多预热也不会误删热门 key。
   */
  private async readIdleSeconds(
    cacheKeys: readonly string[],
  ): Promise<Map<string, number>> {
    const idleSecondsByKey = new Map<string, number>();

    for (
      let start = 0;
      start < cacheKeys.length;
      start += IDLETIME_PIPELINE_CHUNK
    ) {
      const chunk = cacheKeys.slice(start, start + IDLETIME_PIPELINE_CHUNK);
      const result = await this.redisService.executeReadPipeline((pipeline) => {
        for (const cacheKey of chunk) {
          pipeline.object('IDLETIME', cacheKey);
        }
      });
      if (!result.ok) {
        return idleSecondsByKey;
      }
      chunk.forEach((cacheKey, index) => {
        const reply = result.replies[index];
        if (typeof reply === 'number') {
          idleSecondsByKey.set(cacheKey, reply);
        }
      });
    }

    return idleSecondsByKey;
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
