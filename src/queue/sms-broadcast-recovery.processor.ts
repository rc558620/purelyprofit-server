import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SmsBroadcastRecoveryService } from '../purely-profit/marketing/sms/sms-broadcast-recovery.service';

/**
 * 群发短信派发补偿定时任务处理器。
 *
 * 背景：群发是「先扣费、后派发」，派发在扣费事务之外执行。进程崩溃或写库失败
 * 会让任务永久停在 `sending`——钱已扣、短信没发、也没有终态。这个周期任务负责
 * 把这类任务捞出来补发（或判死后交人工退费）。
 *
 * 多 worker 保证：
 * - BullMQ repeatable job 元数据存 Redis，多 worker 共享
 * - 任务执行由 worker 抢占（BLPOP），天然只有一个实例执行
 * - concurrency=1 确保单 worker 内不并发
 */
@Processor('sms-broadcast-recovery', {
  concurrency: 1,
})
export class SmsBroadcastRecoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsBroadcastRecoveryProcessor.name);

  constructor(private readonly recoveryService: SmsBroadcastRecoveryService) {
    super();
  }

  async process(): Promise<number> {
    const startedAt = Date.now();

    try {
      const recovered = await this.recoveryService.recoverStuckTasks();
      const durationMs = Date.now() - startedAt;

      if (recovered > 0) {
        // 有任务被补发说明出过事故，必须留痕
        this.logger.warn(
          `[sms-broadcast-recovery-processor] recovered=${recovered} durationMs=${durationMs}`,
        );
      }

      return recovered;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[sms-broadcast-recovery-processor] failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[sms-broadcast-recovery-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[sms-broadcast-recovery-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
