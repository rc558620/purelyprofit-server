import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { CachePrewarmJobData } from './cache-prewarm.processor';
import type { RetentionCleanupJobData } from './retention-cleanup.processor';
import type { SaleOrderItemsArchiveJobData } from './sale-order-items-archive.processor';
import { PROFIT_PAYMENT_RECONCILE_QUEUE } from './profit-payment-reconcile.processor';

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
    @InjectQueue('sms-broadcast-recovery')
    private readonly smsBroadcastRecoveryQueue: Queue<void>,
    @InjectQueue('sms-delivery-reconcile')
    private readonly smsDeliveryReconcileQueue: Queue<void>,
    @InjectQueue(PROFIT_PAYMENT_RECONCILE_QUEUE)
    private readonly profitPaymentReconcileQueue: Queue<void>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.registerCachePrewarmJob();
    await this.registerSpaceAutoCheckoutJob();
    await this.registerScanOrderingSessionArchiveJob();
    await this.registerRetentionCleanupJobs();
    await this.registerSaleOrderItemsArchiveJob();
    await this.registerSmsBroadcastRecoveryJob();
    await this.registerSmsDeliveryReconcileJob();
    await this.registerProfitPaymentReconcileJob();
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
      this.configService.get<boolean>('app.archiveSaleOrderItemsEnabled') ??
      true;

    if (!enabled) {
      this.logger.log('[queue-scheduler] sale-order-items-archive disabled');
      return;
    }

    const intervalMs =
      this.configService.get<number>('app.archiveSaleOrderItemsIntervalMs') ??
      86_400_000;

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

  /**
   * 注册群发短信派发补偿定时任务
   *
   * 群发是「先扣费后派发」，派发在事务之外执行，进程崩溃会让任务卡在
   * `sending`（钱扣了、短信没发、没有终态）。这个任务负责把它们捞出来补发
   * 或判死，周期取 60s：与「卡死判定阈值」同量级，保证事故在 1~2 分钟内自愈。
   */
  private async registerSmsBroadcastRecoveryJob(): Promise<void> {
    const intervalMs =
      this.configService.get<number>('app.smsBroadcastRecoveryIntervalMs') ??
      60_000;

    await this.smsBroadcastRecoveryQueue.add('scan', undefined, {
      repeat: { every: intervalMs },
      jobId: 'sms-broadcast-recovery-scan', // 固定 jobId，防止重复注册
    });

    this.logger.log(
      `[queue-scheduler] sms-broadcast-recovery registered intervalMs=${intervalMs}`,
    );
  }

  /**
   * 注册送达回执兜底定时任务（天级）
   *
   * 腾讯云回执推送可能丢失，丢了那条短信就永远不知道送达没有、
   * 该退的钱也退不回去。这里每天主动向通道拉一次缺失的回执。
   *
   * 周期 24h：回执兜底本身有 72 小时等待窗口（不急），且要省着用通道配额。
   * 出问题可通过 `app.smsDeliveryReconcileEnabled=false` 单独关停，
   * 不影响群发主链路与分钟级的派发补偿。
   */
  private async registerSmsDeliveryReconcileJob(): Promise<void> {
    const enabled =
      this.configService.get<boolean>('app.smsDeliveryReconcileEnabled') ??
      true;

    if (!enabled) {
      this.logger.log('[queue-scheduler] sms-delivery-reconcile disabled');
      return;
    }

    const intervalMs =
      this.configService.get<number>('app.smsDeliveryReconcileIntervalMs') ??
      86_400_000;

    await this.smsDeliveryReconcileQueue.add('reconcile', undefined, {
      repeat: { every: intervalMs },
      jobId: 'sms-delivery-reconcile-cycle',
    });

    this.logger.log(
      `[queue-scheduler] sms-delivery-reconcile registered intervalMs=${intervalMs}`,
    );
  }

  /**
   * 注册平台收款对账定时任务（默认 30 分钟）
   *
   * 平台收款此前只靠微信回调入账：回调一丢（隧道地址变更 / 进程重启 /
   * 网络抖动）订单就永久停在 pending，表现为「用户已付款、会员没开通」。
   * 这个任务逐笔向微信主动查单，确认已支付就走回调同款入口补入账。
   *
   * 周期取 30 分钟：远大于支付单 15 分钟有效期，保证「确认未支付 → 关单」
   * 只在订单真正过期后执行，同时把丢失回调的自愈延迟控制在半小时内。
   *
   * 除周期任务外额外投一个**启动即跑**的一次性任务：进程重启后
   * 不必等满一个周期，积压的挂起单能在启动后立刻自愈。
   *
   * 出问题可通过 `PROFIT_PAYMENT_RECONCILE_ENABLED=false` 单独关停，
   * 不影响支付主链路与回调入账。
   */
  private async registerProfitPaymentReconcileJob(): Promise<void> {
    const enabled =
      this.configService.get<boolean>('app.platformPaymentReconcileEnabled') ??
      true;

    if (!enabled) {
      this.logger.log('[queue-scheduler] profit-payment-reconcile disabled');
      return;
    }

    const intervalMs =
      this.configService.get<number>(
        'app.platformPaymentReconcileIntervalMs',
      ) ?? 1_800_000;

    await this.profitPaymentReconcileQueue.add('reconcile', undefined, {
      repeat: { every: intervalMs },
      jobId: 'profit-payment-reconcile-cycle', // 固定 jobId，防止重复注册
    });

    // 启动即跑一轮：与周期任务用不同 jobId，避免互相覆盖
    await this.profitPaymentReconcileQueue.add('reconcile', undefined, {
      jobId: 'profit-payment-reconcile-startup',
      removeOnComplete: true,
    });

    this.logger.log(
      `[queue-scheduler] profit-payment-reconcile registered intervalMs=${intervalMs}`,
    );
  }
}
