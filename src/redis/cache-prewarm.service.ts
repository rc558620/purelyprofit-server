import { Injectable, Logger } from '@nestjs/common';

/**
 * 缓存预热服务（遗留兼容层）
 *
 * ⚠️ 调度职责已迁移到 BullMQ（QueueModule > CachePrewarmProcessor）
 *
 * 该类保留为空壳，仅便于：
 * 1. 渐进式迁移期间模块注册无需改动
 * 2. 保留 RedisModule exports 稳定
 * 3. 保留 `waitForRunningCycle()` 供测试套件使用（当前为空实现）
 *
 * 实际调度逻辑：
 * - `src/queue/cache-prewarm.processor.ts`：BullMQ worker 处理器
 * - `src/queue/queue-scheduler.service.ts`：repeatable job 注册
 */
@Injectable()
export class CachePrewarmService {
  private readonly logger = new Logger(CachePrewarmService.name);

  onModuleInit(): void {
    this.logger.log(
      '[cache-prewarm] scheduling delegated to BullMQ (QueueModule)',
    );
  }

  /**
   * 等待当前正在运行的预热周期完成
   *
   * 注意：当前为空实现，因为调度已由 BullMQ 接管。
   * 保留该方法以兼容测试套件可能的调用。
   */
  async waitForRunningCycle(): Promise<void> {
    // BullMQ 调度模式下，此方法无实际等待行为
    return Promise.resolve();
  }
}
