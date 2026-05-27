import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { recordCachePrewarmCycle } from '../observability';
import { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import type { CachePrewarmCycleMetrics } from './cache-prewarm.types';
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

@Injectable()
export class CachePrewarmService implements OnModuleInit, OnModuleDestroy {
  private intervalTimer: NodeJS.Timeout | null = null;
  private initialDelayTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private cycleCount = 0;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly batchSize: number;
  private readonly logEnabled: boolean;
  private readonly logSampleEvery: number;
  private readonly slowCycleThresholdMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly dashboardHomeService: DashboardHomeService,
    private readonly businessAnalysisService: BusinessAnalysisService,
    private readonly financeOverviewService: FinanceOverviewService,
  ) {
    this.enabled =
      this.configService.get<boolean>('app.cachePrewarmEnabled') ?? true;
    this.intervalMs =
      this.configService.get<number>('app.cachePrewarmIntervalMs') ?? 15_000;
    this.initialDelayMs =
      this.configService.get<number>('app.cachePrewarmInitialDelayMs') ?? 5_000;
    this.batchSize =
      this.configService.get<number>('app.cachePrewarmBatchSize') ?? 30;
    this.logEnabled =
      this.configService.get<boolean>('app.cachePrewarmLogEnabled') ?? true;
    this.logSampleEvery = Math.max(
      1,
      this.configService.get<number>('app.cachePrewarmLogSampleEvery') ?? 20,
    );
    this.slowCycleThresholdMs =
      this.configService.get<number>('app.cachePrewarmSlowCycleThresholdMs') ??
      1_500;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }

    this.initialDelayTimer = setTimeout(() => {
      void this.runCycle();
      this.intervalTimer = setInterval(() => {
        void this.runCycle();
      }, this.intervalMs);
    }, this.initialDelayMs);
  }

  onModuleDestroy(): void {
    if (this.initialDelayTimer) {
      clearTimeout(this.initialDelayTimer);
      this.initialDelayTimer = null;
    }

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.cycleCount += 1;
    const currentCycle = this.cycleCount;
    const startedAt = Date.now();

    try {
      const categoryConfigs = createCachePrewarmCategoryConfigs({
        dashboardHomeService: this.dashboardHomeService,
        businessAnalysisService: this.businessAnalysisService,
        financeOverviewService: this.financeOverviewService,
      });
      const cacheKeysByCategory = await Promise.all(
        categoryConfigs.map((config) =>
          this.redisService.scanKeysByPattern(
            config.scanPattern(),
            this.batchSize,
          ),
        ),
      );
      const categoryResultEntries = await Promise.all(
        categoryConfigs.map(async (config, index) => {
          const cacheKeys = cacheKeysByCategory[index] ?? [];
          return [config.category, await config.prewarm(cacheKeys)] as const;
        }),
      );

      const durationMs = Date.now() - startedAt;
      const metrics: CachePrewarmCycleMetrics = buildCachePrewarmCycleMetrics(
        durationMs,
        buildCachePrewarmCategoryResultsMap(categoryResultEntries),
      );

      recordCachePrewarmCycle(metrics);
      this.logCycleSummary(currentCycle, metrics);
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      recordCachePrewarmCycle(buildFailedCachePrewarmCycleMetrics(durationMs));
      console.error('[cache-prewarm] cycle failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  private logCycleSummary(
    cycleId: number,
    metrics: CachePrewarmCycleMetrics,
  ): void {
    if (!this.logEnabled) {
      return;
    }

    if (
      !shouldLogCachePrewarmCycleSummary(
        cycleId,
        metrics,
        this.logSampleEvery,
        this.slowCycleThresholdMs,
      )
    ) {
      return;
    }

    console.info(buildCachePrewarmCycleSummaryLog(cycleId, metrics));
  }
}
