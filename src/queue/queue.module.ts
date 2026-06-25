import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachePrewarmProcessor } from './cache-prewarm.processor';
import { SpaceAutoCheckoutProcessor } from './space-auto-checkout.processor';
import { QueueSchedulerService } from './queue-scheduler.service';
import { RedisModule } from '../redis/redis.module';
import { SpacesModule } from '../purely-profit/operations/spaces/spaces.module';

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
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // BullMQ 需要独立的 Redis 连接，因为：
        // 1. maxRetriesPerRequest 必须为 null（BLPOP 等阻塞命令需无限等待）
        // 2. RedisService 的连接使用 maxRetriesPerRequest=3，两者不能复用
        // 3. BullMQ 还会额外创建 subscriber 连接用于监听任务事件
        const connection = new Redis({
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password') || undefined,
          db: configService.get<number>('redis.db'),
          connectTimeout:
            configService.get<number>('redis.connectTimeoutMs') ?? 5_000,
          // BullMQ 内部使用 BLPOP 等阻塞命令，必须设为 null（无限等待）。
          // 若使用有限值（如 3），Redis 暂时不可达时 BullMQ Worker 会直接抛出
          // "Command timed out" 导致队列停摆。
          maxRetriesPerRequest: null,
          // 启用离线队列：Redis 断连期间命令排队，重连后自动发送
          enableOfflineQueue: true,
          // 自动重连策略：指数退避，最大 5 秒间隔
          retryStrategy(times: number) {
            const delay = Math.min(times * 200, 5_000);
            return delay;
          },
        });

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
    ),
    RedisModule, // 提供 CachePrewarmCycleService
    SpacesModule, // 提供 SpaceSessionAutoCheckoutService
  ],
  providers: [
    CachePrewarmProcessor,
    SpaceAutoCheckoutProcessor,
    QueueSchedulerService,
  ],
  exports: [],
})
export class QueueModule {}
