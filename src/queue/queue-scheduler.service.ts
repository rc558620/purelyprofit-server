import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { CachePrewarmJobData } from './cache-prewarm.processor';

/**
 * 队列调度服务
 *
 * 功能：
 * - 应用启动时自动注册 repeatable jobs（定时任务）
 * - 管理 cache-prewarm、space-auto-checkout 等周期性任务
 *
 * 注意：
 * - BullMQ repeatable jobs 元数据存储在 Redis，多 worker 共享
 * - 应用重启后任务自动恢复，无需重新注册（除非 pattern 变更）
 * - 任务实际执行由 worker 抢占（基于 Redis BLPOP），天然支持多 worker 负载均衡
 */
@Injectable()
export class QueueSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(QueueSchedulerService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('cache-prewarm')
    private readonly cachePrewarmQueue: Queue<CachePrewarmJobData>,
    @InjectQueue('space-auto-checkout')
    private readonly spaceAutoCheckoutQueue: Queue<void>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.registerCachePrewarmJob();
    await this.registerSpaceAutoCheckoutJob();
  }

  /**
   * 注册缓存预热定时任务
   *
   * 调度模式：每 15s 执行一次（可通过配置调整）
   */
  private async registerCachePrewarmJob(): Promise<void> {
    const enabled =
      this.configService.get<boolean>('app.cachePrewarmEnabled') ?? true;

    if (!enabled) {
      this.logger.log('[queue-scheduler] cache-prewarm disabled');
      return;
    }

    const intervalMs =
      this.configService.get<number>('app.cachePrewarmIntervalMs') ?? 15_000;
    const batchSize =
      this.configService.get<number>('app.cachePrewarmBatchSize') ?? 30;
    const concurrency = Math.max(
      1,
      this.configService.get<number>('app.cachePrewarmConcurrency') ?? 4,
    );
    const logEnabled =
      this.configService.get<boolean>('app.cachePrewarmLogEnabled') ?? true;
    const logSampleEvery = Math.max(
      1,
      this.configService.get<number>('app.cachePrewarmLogSampleEvery') ?? 20,
    );
    const slowCycleThresholdMs =
      this.configService.get<number>('app.cachePrewarmSlowCycleThresholdMs') ??
      1_500;

    await this.cachePrewarmQueue.add(
      'cycle',
      {
        batchSize,
        concurrency,
        logEnabled,
        logSampleEvery,
        slowCycleThresholdMs,
      },
      {
        repeat: {
          every: intervalMs,
        },
        jobId: 'cache-prewarm-cycle', // 固定 jobId，防止重复注册
      },
    );

    this.logger.log(
      `[queue-scheduler] cache-prewarm registered intervalMs=${intervalMs}`,
    );
  }

  /**
   * 注册空间自动结账定时任务
   *
   * 调度模式：每 60s 执行一次（可通过配置调整）
   */
  private async registerSpaceAutoCheckoutJob(): Promise<void> {
    const enabled =
      this.configService.get<boolean>('app.spaceAutoCheckoutEnabled') ?? true;

    if (!enabled) {
      this.logger.log('[queue-scheduler] space-auto-checkout disabled');
      return;
    }

    const intervalMs =
      this.configService.get<number>('app.spaceAutoCheckoutIntervalMs') ??
      60_000;

    await this.spaceAutoCheckoutQueue.add('scan', undefined, {
      repeat: {
        every: intervalMs,
      },
      jobId: 'space-auto-checkout-scan', // 固定 jobId，防止重复注册
    });

    this.logger.log(
      `[queue-scheduler] space-auto-checkout registered intervalMs=${intervalMs}`,
    );
  }
}
