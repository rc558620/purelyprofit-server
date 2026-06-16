import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CachePrewarmCycleService } from './cache-prewarm-cycle.service';

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
  private readonly concurrency: number;
  private readonly logEnabled: boolean;
  private readonly logSampleEvery: number;
  private readonly slowCycleThresholdMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly cycleService: CachePrewarmCycleService,
  ) {
    this.enabled =
      this.configService.get<boolean>('app.cachePrewarmEnabled') ?? true;
    this.intervalMs =
      this.configService.get<number>('app.cachePrewarmIntervalMs') ?? 15_000;
    this.initialDelayMs =
      this.configService.get<number>('app.cachePrewarmInitialDelayMs') ?? 5_000;
    this.batchSize =
      this.configService.get<number>('app.cachePrewarmBatchSize') ?? 30;
    this.concurrency = Math.max(
      1,
      this.configService.get<number>('app.cachePrewarmConcurrency') ?? 4,
    );
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
      this.intervalTimer.unref?.();
    }, this.initialDelayMs);
    this.initialDelayTimer.unref?.();
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

    try {
      await this.cycleService.runCycle({
        cycleId: this.cycleCount,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
        logEnabled: this.logEnabled,
        logSampleEvery: this.logSampleEvery,
        slowCycleThresholdMs: this.slowCycleThresholdMs,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
