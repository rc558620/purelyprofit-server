import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * 构建 BullMQ 根连接配置。
 *
 * 说明：BullMQ 需要独立 Redis 连接，且 maxRetriesPerRequest 必须为 null，
 * 因此这里不复用 RedisService。
 */
export const createBullMqConnection = (configService: ConfigService): Redis => {
  return new Redis({
    host: configService.get<string>('redis.host'),
    port: configService.get<number>('redis.port'),
    password: configService.get<string>('redis.password') || undefined,
    db: configService.get<number>('redis.db'),
    connectTimeout:
      configService.get<number>('redis.connectTimeoutMs') ?? 5_000,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy(times: number): number {
      return Math.min(times * 200, 5_000);
    },
  });
};
