import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RetentionCleanupService } from './retention-cleanup.service';

export interface RetentionCleanupJobData {
  /** 清理任务类型：idempotency / audit_logs */
  taskType: 'idempotency' | 'audit_logs';
}

/**
 * 无界增长表保留期清理定时任务处理器。
 *
 * 功能：
 * - 每 6h 执行 idempotency_records 清理（保留 7 天）
 * - 每 24h 执行 audit_logs 分批清理（保留 90 天）
 * - BullMQ repeatable job 确保多 worker 环境下只有一个实例执行
 *
 * 多 worker 保证：
 * - BullMQ repeatable job 元数据存 Redis，多 worker 共享
 * - 任务实际执行由 worker 抢占（BLPOP），天然只有一个实例执行
 * - concurrency=1 确保单 worker 内不并发
 */
@Processor('retention-cleanup', {
  concurrency: 1,
})
export class RetentionCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionCleanupProcessor.name);

  constructor(
    private readonly retentionCleanupService: RetentionCleanupService,
  ) {
    super();
  }

  async process(
    job: Job<RetentionCleanupJobData, number, string>,
  ): Promise<number> {
    const { taskType } = job.data;
    const startedAt = Date.now();

    try {
      let deletedCount: number;

      if (taskType === 'idempotency') {
        deletedCount =
          await this.retentionCleanupService.cleanupIdempotencyRecords();
      } else if (taskType === 'audit_logs') {
        deletedCount = await this.retentionCleanupService.cleanupAuditLogs();
      } else {
        this.logger.warn(
          `[retention-cleanup-processor] unknown taskType=${taskType}`,
        );
        return 0;
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[retention-cleanup-processor] completed taskType=${taskType} deleted=${deletedCount} durationMs=${durationMs}`,
      );

      return deletedCount;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[retention-cleanup-processor] failed taskType=${taskType} durationMs=${durationMs} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.logger.log('[retention-cleanup-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `[retention-cleanup-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
