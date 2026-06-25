import { Injectable, Logger } from '@nestjs/common';

/**
 * 空间自动结账调度器（遗留兼容层）
 *
 * ⚠️ 调度职责已迁移到 BullMQ（QueueModule > SpaceAutoCheckoutProcessor）
 *
 * 该类保留为空壳，仅便于：
 * 1. 渐进式迁移期间模块注册无需改动
 * 2. 保留 SpacesModule exports 稳定
 *
 * 实际调度逻辑：
 * - `src/queue/space-auto-checkout.processor.ts`：BullMQ worker 处理器
 * - `src/queue/queue-scheduler.service.ts`：repeatable job 注册
 */
@Injectable()
export class SpaceAutoCheckoutSchedulerService {
  private readonly logger = new Logger(SpaceAutoCheckoutSchedulerService.name);

  onModuleInit(): void {
    this.logger.log(
      '[space-auto-checkout-scheduler] scheduling delegated to BullMQ (QueueModule)',
    );
  }
}
