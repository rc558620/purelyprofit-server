import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ClubPaymentCallbackDispatchService } from '../purely-club/payments/club-payment-callback-dispatch.service';
import { ClubPaymentCallbackFailureService } from '../purely-club/payments/club-payment-callback-failure.service';
import type { ClubPaymentCallbackJobData } from './club-payment-callback.types';

/** 微信支付成功回调异步处理器。 */
@Processor('club-payment-callback', { concurrency: 8 })
export class ClubPaymentCallbackProcessor extends WorkerHost {
  private readonly logger = new Logger(ClubPaymentCallbackProcessor.name);

  constructor(
    private readonly dispatchService: ClubPaymentCallbackDispatchService,
    private readonly failureService: ClubPaymentCallbackFailureService,
  ) {
    super();
  }

  async process(
    job: Job<ClubPaymentCallbackJobData, unknown, string>,
  ): Promise<unknown> {
    const { orderNo, settlementParams } = job.data;
    try {
      const result = await this.dispatchService.dispatchByOrderNo(
        orderNo,
        settlementParams,
      );
      this.logger.log(
        `[club-payment-callback] completed job=${job.id ?? 'unknown'} orderNo=${orderNo}`,
      );
      return result;
    } catch (error: unknown) {
      this.logger.error(
        `[club-payment-callback] failed job=${job.id ?? 'unknown'} orderNo=${orderNo} reason=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[club-payment-callback] worker ready');
  }

  /**
   * 任务失败事件。
   *
   * 只有**重试耗尽**才落死信：中间失败是正常抖动，落死信会让待办列表
   * 被瞬时故障刷屏，真正需要人工介入的那条反而被淹没。
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ClubPaymentCallbackJobData> | undefined,
    error: Error,
  ): Promise<void> {
    this.logger.error(
      `[club-payment-callback] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
    await this.recordDeadLetterIfExhausted(job, error);
  }

  private async recordDeadLetterIfExhausted(
    job: Job<ClubPaymentCallbackJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;

    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    try {
      await this.failureService.recordRetryExhausted({
        orderNo: job.data.orderNo,
        attempts: job.attemptsMade,
        reason: error.message,
        settlementParams: job.data.settlementParams,
      });
    } catch (recordError: unknown) {
      // 死信写入失败也要留痕，否则这笔「钱已扣未到账」连最后一条线索都没有
      this.logger.error(
        `[club-payment-callback] 死信写入失败 orderNo=${job.data.orderNo}: ${
          recordError instanceof Error
            ? recordError.message
            : String(recordError)
        }`,
      );
    }
  }
}
