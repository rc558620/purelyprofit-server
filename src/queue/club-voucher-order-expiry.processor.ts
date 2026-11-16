import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ClubVoucherOrderExpiryService } from './club-voucher-order-expiry.service';

/** 队列名：与 queue.module.ts / queue-scheduler.service.ts 中的注册名保持一致 */
export const CLUB_VOUCHER_ORDER_EXPIRY_QUEUE = 'club-voucher-order-expiry';

/**
 * 团购券订单过期翻转定时任务处理器。
 *
 * - 每 5min 扫描一次「pending 且已过有效期」的订单并翻转（消费端读接口不再写库）；
 * - concurrency=1：单 worker 内不并发，配合 UPDATE 的状态前置条件保证不重复处理；
 * - 多 worker 环境由 BullMQ repeatable job 保证只有一个实例执行。
 */
@Processor(CLUB_VOUCHER_ORDER_EXPIRY_QUEUE, {
  concurrency: 1,
})
export class ClubVoucherOrderExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ClubVoucherOrderExpiryProcessor.name);

  constructor(
    private readonly clubVoucherOrderExpiryService: ClubVoucherOrderExpiryService,
  ) {
    super();
  }

  async process(): Promise<number> {
    return this.clubVoucherOrderExpiryService.expireOverdueOrders();
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[club-voucher-order-expiry-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[club-voucher-order-expiry-processor] job failed id=${
        job?.id ?? 'unknown'
      } reason=${error.message}`,
      error.stack,
    );
  }
}
