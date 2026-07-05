import { readFileSync } from 'node:fs';
import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * 从 ConfigService 构建 Redis 连接选项（含 TLS 支持）
 *
 * - 当 `redis.tlsEnabled` 为 true 时启用 TLS 连接
 * - 可选配置 CA 证书路径和证书验证开关
 * - 同时适用于 RedisService 和 ThrottlerModule 的 Redis 连接
 */
export function buildRedisConnectionOptions(
  configService: ConfigService,
): RedisOptions {
  const baseOptions: RedisOptions = {
    host: configService.get<string>('redis.host'),
    port: configService.get<number>('redis.port'),
    password: configService.get<string>('redis.password') || undefined,
    db: configService.get<number>('redis.db'),
    connectTimeout:
      configService.get<number>('redis.connectTimeoutMs') ?? 5_000,
    maxRetriesPerRequest:
      configService.get<number>('redis.maxRetriesPerRequest') ?? 3,
    enableReadyCheck: true,
    lazyConnect: false,
    enableOfflineQueue: true,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5_000);
      return delay;
    },
  };

  const tlsEnabled = configService.get<boolean>('redis.tlsEnabled') ?? false;

  if (tlsEnabled) {
    const caCertPath = configService.get<string>('redis.tlsCaCertPath') ?? '';
    const rejectUnauthorized =
      configService.get<boolean>('redis.tlsRejectUnauthorized') ?? true;

    baseOptions.tls = {
      rejectUnauthorized,
      ...(caCertPath ? { ca: readFileSync(caCertPath, 'utf-8') } : {}),
    };
  }

  return baseOptions;
}
