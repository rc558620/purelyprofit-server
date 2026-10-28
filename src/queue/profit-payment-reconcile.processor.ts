import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PlatformPaymentReconcileService } from '../purely-profit/payments/platform-payment-reconcile.service';
import type { PlatformPaymentReconcileSummary } from '../purely-profit/payments/platform-payment-reconcile.service';

/**
 * 平台收款对账定时任务处理器。
 *
 * 与「回调入账」是两条独立路径：回调实时但可能丢失，对账滞后但能兜底。
 * 独立成队列的原因与其它兜底任务一致 —— 周期、重要性与故障影响面都不同，
 * 出问题时需要能单独停掉（`PROFIT_PAYMENT_RECONCILE_ENABLED=false`）。
 *
 * 多 worker 保证同其它 processor：repeatable job 元数据在 Redis，
 * 由 worker 抢占执行，concurrency=1 保证单 worker 内不并发。
 */
export const PROFIT_PAYMENT_RECONCILE_QUEUE = 'profit-payment-reconcile';

@Processor(PROFIT_PAYMENT_RECONCILE_QUEUE, {
  concurrency: 1,
})
export class ProfitPaymentReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfitPaymentReconcileProcessor.name);

  constructor(
    private readonly reconcileService: PlatformPaymentReconcileService,
  ) {
    super();
  }

  async process(): Promise<PlatformPaymentReconcileSummary> {
    const startedAt = Date.now();

    try {
      const summary = await this.reconcileService.reconcile();
      const durationMs = Date.now() - startedAt;

      // 补到入账说明有回调丢失，核对出错说明微信侧连通性有问题，都必须留痕
      if (summary.settled > 0 || summary.failed > 0) {
        this.logger.warn(
          `[profit-payment-reconcile-processor] scanned=${summary.scanned} ` +
            `settled=${summary.settled} closed=${summary.closed} ` +
            `failed=${summary.failed} durationMs=${durationMs}`,
        );
      }

      return summary;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[profit-payment-reconcile-processor] failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      // 抛出去交给 BullMQ 记录，下一周期自然会重试（服务内部已有 Redis 锁兜并发）
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[profit-payment-reconcile-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[profit-payment-reconcile-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
