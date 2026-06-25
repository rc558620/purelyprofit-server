import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CachePrewarmCycleService } from '../redis/cache-prewarm-cycle.service';

export interface CachePrewarmJobData {
  batchSize: number;
  concurrency: number;
  logEnabled: boolean;
  logSampleEvery: number;
  slowCycleThresholdMs: number;
}

/**
 * 缓存预热定时任务处理器
 *
 * 功能：
 * - 每 15s 执行一轮缓存预热：首页、经营分析、财务概览等热点数据
 * - 替代原有 `CachePrewarmService` 的 `setInterval` 轮询模式
 * - BullMQ repeatable job 确保多 worker 环境下只有一个实例执行
 *
 * 任务调度：
 * - 由 BullMQ 定时触发（每 15s）
 * - 任务重复模式见 `QueueSchedulerService` 配置
 */
@Processor('cache-prewarm', {
  concurrency: 1, // 单worker单并发，防止同一worker内重复执行
})
export class CachePrewarmProcessor extends WorkerHost {
  private readonly logger = new Logger(CachePrewarmProcessor.name);
  private cycleCount = 0;

  constructor(private readonly cycleService: CachePrewarmCycleService) {
    super();
  }

  async process(job: Job<CachePrewarmJobData, void, string>): Promise<void> {
    const {
      batchSize,
      concurrency,
      logEnabled,
      logSampleEvery,
      slowCycleThresholdMs,
    } = job.data;

    this.cycleCount += 1;

    await this.cycleService.runCycle({
      cycleId: this.cycleCount,
      batchSize,
      concurrency,
      logEnabled,
      logSampleEvery,
      slowCycleThresholdMs,
    });
  }

  @OnWorkerEvent('ready')
  onReady() {
    this.logger.log('[cache-prewarm-processor] worker ready');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `[cache-prewarm-processor] job failed id=${job?.id ?? 'unknown'} reason=${error.message}`,
      error.stack,
    );
  }
}
