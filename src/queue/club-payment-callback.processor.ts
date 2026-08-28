import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ClubPaymentCallbackDispatchService } from '../purely-club/payments/club-payment-callback-dispatch.service';
import type { ClubPaymentCallbackJobData } from './club-payment-callback.types';

/** 微信支付成功回调异步处理器。 */
@Processor('club-payment-callback', { concurrency: 8 })
export class ClubPaymentCallbackProcessor extends WorkerHost {
  private readonly logger = new Logger(ClubPaymentCallbackProcessor.name);

  constructor(
    private readonly dispatchService: ClubPaymentCallbackDispatchService,
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

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[club-payment-callback] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
