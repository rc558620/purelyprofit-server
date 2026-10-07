import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { CachePrewarmJobData } from './cache-prewarm.processor';
import type { RetentionCleanupJobData } from './retention-cleanup.processor';
import type { SaleOrderItemsArchiveJobData } from './sale-order-items-archive.processor';

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
    @InjectQueue('scan-ordering-session-archive')
    private readonly scanOrderingSessionArchiveQueue: Queue<void>,
    @InjectQueue('retention-cleanup')
    private readonly retentionCleanupQueue: Queue<RetentionCleanupJobData>,
    @InjectQueue('sale-order-items-archive')
    private readonly saleOrderItemsArchiveQueue: Queue<SaleOrderItemsArchiveJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.registerCachePrewarmJob();
    await this.registerSpaceAutoCheckoutJob();
    await this.registerScanOrderingSessionArchiveJob();
    await this.registerRetentionCleanupJobs();
    await this.registerSaleOrderItemsArchiveJob();
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

  private async registerScanOrderingSessionArchiveJob(): Promise<void> {
    await this.scanOrderingSessionArchiveQueue.add('scan', undefined, {
      repeat: { every: 5 * 60_000 },
      jobId: 'scan-ordering-session-archive-scan',
    });
    this.logger.log(
      '[queue-scheduler] scan-ordering-session-archive registered intervalMs=300000',
    );
  }

  /**
   * 注册无界增长表保留期清理定时任务
   *
   * - idempotency_records：每 6h 执行一次，保留 7 天
   * - audit_logs：每 24h 执行一次，保留 90 天，分批 DELETE
   */
  private async registerRetentionCleanupJobs(): Promise<void> {
    // idempotency_records 清理：每 6h
    await this.retentionCleanupQueue.add(
      'cleanup',
      { taskType: 'idempotency' },
      {
        repeat: { every: 6 * 60 * 60_000 },
        jobId: 'retention-cleanup-idempotency',
      },
    );
    this.logger.log(
      '[queue-scheduler] retention-cleanup idempotency registered intervalMs=21600000',
    );

    // audit_logs 清理：每 24h
    await this.retentionCleanupQueue.add(
      'cleanup',
      { taskType: 'audit_logs' },
      {
        repeat: { every: 24 * 60 * 60_000 },
        jobId: 'retention-cleanup-audit-logs',
      },
    );
    this.logger.log(
      '[queue-scheduler] retention-cleanup audit_logs registered intervalMs=86400000',
    );
  }

  /**
   * 注册 sale_order_items 归档定时任务
   *
   * 每 24h 执行一次，将超过保留窗口（默认 180 天）的冷数据
   * 迁移到 sale_order_items_archive 表。
   */
  private async registerSaleOrderItemsArchiveJob(): Promise<void> {
    const enabled =
      this.configService.get<boolean>(
        'app.archiveSaleOrderItemsEnabled',
      ) ?? true;

    if (!enabled) {
      this.logger.log(
        '[queue-scheduler] sale-order-items-archive disabled',
      );
      return;
    }

    const intervalMs =
      this.configService.get<number>(
        'app.archiveSaleOrderItemsIntervalMs',
      ) ?? 86_400_000;

    await this.saleOrderItemsArchiveQueue.add(
      'archive',
      { taskType: 'archive' },
      {
        repeat: { every: intervalMs },
        jobId: 'sale-order-items-archive-cycle',
      },
    );
    this.logger.log(
      `[queue-scheduler] sale-order-items-archive registered intervalMs=${intervalMs}`,
    );
  }
}
