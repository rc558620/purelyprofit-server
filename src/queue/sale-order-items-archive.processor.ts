import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SaleOrderItemsArchiveService } from './sale-order-items-archive.service';

export interface SaleOrderItemsArchiveJobData {
  /** 任务类型（预留扩展，当前固定为 'archive'） */
  taskType: 'archive';
}

/**
 * sale_order_items 归档定时任务处理器。
 *
 * 功能：
 * - 每 24h 执行一次，将超过保留窗口（默认 180 天）的冷数据迁移到归档表
 * - BullMQ repeatable job 确保多 worker 环境下只有一个实例执行
 *
 * 多 worker 保证：
 * - BullMQ repeatable job 元数据存 Redis，多 worker 共享
 * - 任务实际执行由 worker 抢占（BLPOP），天然只有一个实例执行
 * - concurrency=1 确保单 worker 内不并发
 */
@Processor('sale-order-items-archive', {
  concurrency: 1,
})
export class SaleOrderItemsArchiveProcessor extends WorkerHost {
  private readonly logger = new Logger(SaleOrderItemsArchiveProcessor.name);

  constructor(
    private readonly archiveService: SaleOrderItemsArchiveService,
  ) {
    super();
  }

  async process(
    job: Job<SaleOrderItemsArchiveJobData, number, string>,
  ): Promise<number> {
    const { taskType } = job.data;
    const startedAt = Date.now();

    if (taskType !== 'archive') {
      this.logger.warn(
        `[sale-order-items-archive-processor] unknown taskType=${taskType}`,
      );
      return 0;
    }

    try {
      const archivedCount = await this.archiveService.archiveColdRecords();

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[sale-order-items-archive-processor] completed archived=${archivedCount} durationMs=${durationMs}`,
      );

      return archivedCount;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[sale-order-items-archive-processor] failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[sale-order-items-archive-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[sale-order-items-archive-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
