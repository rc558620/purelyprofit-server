import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createBullMqConnection } from './queue-bullmq.config';
import { CachePrewarmProcessor } from './cache-prewarm.processor';
import { SpaceAutoCheckoutProcessor } from './space-auto-checkout.processor';
import { QueueSchedulerService } from './queue-scheduler.service';
import { RedisModule } from '../redis/redis.module';
import { SpacesModule } from '../purely-profit/operations/spaces/spaces.module';
import { ScanOrderingModule } from '../purely-profit/operations/scan-ordering/scan-ordering.module';
import { ScanOrderingSessionArchiveProcessor } from './scan-ordering-session-archive.processor';
import { ClubPaymentCallbackQueueModule } from '../purely-club/payments/club-payment-callback-queue.module';

/**
 * 消息队列模块
 *
 * 功能：
 * - 基于 BullMQ + Redis 提供异步任务调度能力
 * - 支持定时任务、延时任务、优先级队列、重试与超时策略
 * - 替代原有 setInterval 轮询模式，提升多 worker 环境下的任务调度可靠性
 *
 * 当前队列：
 * - `cache-prewarm`：定时预热首页、经营分析等热点缓存（每 15s）
 * - `space-auto-checkout`：定时扫描并自动结账超时空间会话（每 60s）
 * - `club-payment-callback`：异步处理微信支付成功回调
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connection = createBullMqConnection(configService);

        return {
          connection,
          defaultJobOptions: {
            // 默认任务选项：失败后不自动重试（定时任务等下一周期即可）
            attempts: 1,
            // 任务超时：防止单任务无限占用 worker
            timeout: 60_000, // 60s
            // 完成后保留 1 天，便于排查
            removeOnComplete: {
              age: 86400, // 1 day
              count: 100, // 最多保留 100 个
            },
            // 失败后保留 7 天，便于排查
            removeOnFail: {
              age: 604800, // 7 days
              count: 500, // 最多保留 500 个
            },
          },
        };
      },
    }),
    BullModule.registerQueue(
      {
        name: 'cache-prewarm',
      },
      {
        name: 'space-auto-checkout',
      },
      {
        name: 'scan-ordering-session-archive',
      },
    ),
    ClubPaymentCallbackQueueModule,
    RedisModule, // 提供 CachePrewarmCycleService
    SpacesModule, // 提供 SpaceSessionAutoCheckoutService
    ScanOrderingModule,
  ],
  providers: [
    CachePrewarmProcessor,
    SpaceAutoCheckoutProcessor,
    ScanOrderingSessionArchiveProcessor,
    QueueSchedulerService,
  ],
  exports: [],
})
export class QueueModule {}
