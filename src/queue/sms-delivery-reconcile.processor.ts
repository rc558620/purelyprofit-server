import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SmsDeliveryReconcileService } from '../purely-profit/marketing/sms/sms-delivery-reconcile.service';

/**
 * 送达回执兜底定时任务处理器（天级）。
 *
 * 与 `sms-broadcast-recovery`（分钟级派发补偿）分开注册：
 * 一个抢救发送中断，一个核销资金偏差，周期和重要性都不同，
 * 出问题时需要能单独停掉其中一个。
 *
 * 多 worker 保证同其它 processor：repeatable job 元数据在 Redis，
 * 由 worker 抢占执行，concurrency=1 保证单 worker 内不并发。
 */
@Processor('sms-delivery-reconcile', {
  concurrency: 1,
})
export class SmsDeliveryReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsDeliveryReconcileProcessor.name);

  constructor(private readonly reconcileService: SmsDeliveryReconcileService) {
    super();
  }

  async process(): Promise<number> {
    const startedAt = Date.now();

    try {
      const { reconciled, refundedFen } =
        await this.reconcileService.reconcile();
      const durationMs = Date.now() - startedAt;

      // 补到回执说明通道推送丢过、退到钱说明有遗漏，都属于资金问题，必须留痕
      if (reconciled > 0 || refundedFen > 0) {
        this.logger.warn(
          `[sms-delivery-reconcile-processor] reconciled=${reconciled} ` +
            `refundedFen=${refundedFen} durationMs=${durationMs}`,
        );
      }

      return reconciled;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[sms-delivery-reconcile-processor] failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      // 兜底失败不影响发送链路：抛出去交给 BullMQ 记录，下一周期自然会重试
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[sms-delivery-reconcile-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[sms-delivery-reconcile-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
