import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SpaceSessionAutoCheckoutService } from '../purely-profit/operations/spaces/space-session-auto-checkout.service';

/**
 * 空间自动结账定时任务处理器
 *
 * 功能：
 * - 每 60s 扫描所有门店，对超时的倒计时空间会话执行自动结账
 * - 替代原有 `SpaceAutoCheckoutSchedulerService` 的 `setInterval` 轮询模式
 * - BullMQ repeatable job 确保多 worker 环境下只有一个实例执行
 *
 * 任务调度：
 * - 由 BullMQ 定时触发（cron: 每分钟）
 * - 任务重复模式见 `@Processor` 配置
 */
@Processor('space-auto-checkout', {
  concurrency: 1, // 单worker单并发，防止同一worker内重复执行
})
export class SpaceAutoCheckoutProcessor extends WorkerHost {
  private readonly logger = new Logger(SpaceAutoCheckoutProcessor.name);

  constructor(
    private readonly autoCheckoutService: SpaceSessionAutoCheckoutService,
  ) {
    super();
  }

  async process(job: Job<void, number, string>): Promise<number> {
    const startedAt = Date.now();

    try {
      const settledCount =
        await this.autoCheckoutService.autoCheckoutAllExpiredSessions(
          Date.now(),
        );

      const durationMs = Date.now() - startedAt;

      if (settledCount > 0) {
        this.logger.log(
          `[space-auto-checkout-processor] settled=${settledCount} durationMs=${durationMs}`,
        );
      }

      return settledCount;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[space-auto-checkout-processor] failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error; // 让 BullMQ 记录失败，下一周期再执行
    }
  }

  @OnWorkerEvent('ready')
  onReady() {
    this.logger.log('[space-auto-checkout-processor] worker ready');
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(
      `[space-auto-checkout-processor] job active id=${job.id}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: number) {
    if (result > 0) {
      this.logger.log(
        `[space-auto-checkout-processor] job completed id=${job.id} settled=${result}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `[space-auto-checkout-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
