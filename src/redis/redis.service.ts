import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { recordRedisOperation } from '../observability';
import { countPipelineDeleted } from './concurrency-limiter.util';
import { safeJsonStringify } from './redis-json.util';
import { buildRedisConnectionOptions } from '../shared/redis-connection.utils';

type RedisOutcome = 'hit' | 'miss' | 'neutral';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private readonly slowRedisLogEnabled: boolean;
  private readonly slowRedisThresholdMs: number;

  constructor(private readonly configService: ConfigService) {
    this.slowRedisLogEnabled =
      this.configService.get<boolean>('app.slowRedisLogEnabled') ?? true;
    this.slowRedisThresholdMs =
      this.configService.get<number>('app.slowRedisThresholdMs') ?? 20;
  }

  onModuleInit() {
    const redisOptions = buildRedisConnectionOptions(this.configService);
    const commandTimeout =
      this.configService.get<number>('redis.commandTimeoutMs') ?? 3_000;

    this.client = new Redis({
      ...redisOptions,
      commandTimeout,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(
        `[redis] connection error: ${error.message}`,
        error.stack,
      );
    });

    this.client.on('close', () => {
      this.logger.warn(
        '[redis] connection closed, will attempt reconnect via retryStrategy',
      );
    });

    this.client.on('reconnecting', () => {
      this.logger.log('[redis] reconnecting...');
    });

    this.client.on('ready', () => {
      this.logger.log('[redis] connection ready');
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.observeRedisCommand(
      'GET',
      () => this.client.get(key),
      (result) => (result === null ? 'miss' : 'hit'),
    );
  }

  async getJson<T>(key: string): Promise<T | null> {
    const rawValue = await this.get(key);
    if (rawValue === null) {
      return null;
    }

    return JSON.parse(rawValue) as T;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.observeRedisCommand('SET', async () => {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      }

      await this.client.set(key, value);
    });
  }

  /**
   * 原子递增 key 对应的值，key 不存在时从 0 开始递增（结果为 1）。
   * 可选地在递增后设置过期时间（仅首次创建 key 时生效，避免覆盖已有 TTL）。
   * 返回递增后的值。
   */
  async incr(key: string, ttlSecondsOnCreate?: number): Promise<number> {
    return this.observeRedisCommand('INCR', async () => {
      const result = await this.client.incr(key);
      // 仅在 key 首次创建时（result === 1）设置 TTL
      if (result === 1 && ttlSecondsOnCreate) {
        await this.client.expire(key, ttlSecondsOnCreate);
      }
      return result;
    });
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return this.observeRedisCommand(
      'SET',
      async () => {
        const result = await this.client.set(
          key,
          value,
          'EX',
          ttlSeconds,
          'NX',
        );
        return result === 'OK';
      },
      (result) => (result ? 'hit' : 'miss'),
    );
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, safeJsonStringify(value), ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.observeRedisCommand('DEL', async () => {
      await this.client.del(key);
    });
  }

  async delMany(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    return this.observeRedisCommand('DEL', () => this.client.del(...keys));
  }

  async delByPattern(pattern: string): Promise<number> {
    const startedAt = Date.now();
    let cursor = '0';
    let totalDeleted = 0;
    const pipelineBatchSize = 200;
    const pipeline = this.client.pipeline();
    let pendingOps = 0;

    do {
      const [nextCursor, batchKeys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of batchKeys) {
        pipeline.unlink(key);
        pendingOps += 1;

        if (pendingOps >= pipelineBatchSize) {
          const results = await pipeline.exec();
          if (results === null) {
            this.logger.warn(
              `[redis] pipeline.exec() returned null during delByPattern pattern=${pattern} pendingOps=${pendingOps}`,
            );
          } else {
            totalDeleted += countPipelineDeleted(results);
          }
          pendingOps = 0;
        }
      }
    } while (cursor !== '0');

    if (pendingOps > 0) {
      const results = await pipeline.exec();
      if (results === null) {
        this.logger.warn(
          `[redis] pipeline.exec() returned null during delByPattern (final flush) pattern=${pattern} pendingOps=${pendingOps}`,
        );
      } else {
        totalDeleted += countPipelineDeleted(results);
      }
    }

    const durationMs = Date.now() - startedAt;
    recordRedisOperation({
      command: 'UNLINK',
      durationMs,
      outcome: totalDeleted > 0 ? 'hit' : 'miss',
      slowThresholdMs: this.slowRedisThresholdMs,
    });

    if (this.slowRedisLogEnabled && durationMs >= this.slowRedisThresholdMs) {
      this.logger.warn(
        `[slow-redis] UNLINK ${durationMs}ms pattern=${pattern} deleted=${totalDeleted}`,
      );
    }

    return totalDeleted;
  }

  async scanKeysByPattern(pattern: string, limit?: number): Promise<string[]> {
    let cursor = '0';
    const keys: string[] = [];

    do {
      const [nextCursor, batchKeys] = await this.observeRedisCommand(
        'SCAN',
        () => this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100),
      );
      cursor = nextCursor;
      keys.push(...batchKeys);

      if (limit !== undefined && keys.length >= limit) {
        return keys.slice(0, limit);
      }
    } while (cursor !== '0');

    return keys;
  }

  async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    const rawValues = await this.observeRedisCommand(
      'MGET',
      () => this.client.mget(...keys),
      (results) => {
        const hitCount = results.filter((v) => v !== null).length;
        return hitCount === 0
          ? 'miss'
          : hitCount === results.length
            ? 'hit'
            : 'neutral';
      },
    );

    return rawValues.map((raw) =>
      raw === null ? null : (JSON.parse(raw) as T),
    );
  }

  async exists(key: string): Promise<boolean> {
    return this.observeRedisCommand(
      'EXISTS',
      async () => {
        const result = await this.client.exists(key);
        return result === 1;
      },
      (result) => (result ? 'hit' : 'miss'),
    );
  }

  getClient(): Redis {
    return this.client;
  }

  async checkReadiness(): Promise<void> {
    const pong = await this.observeRedisCommand('PING', () =>
      this.client.ping(),
    );
    if (pong !== 'PONG') {
      throw new Error(`unexpected redis ping response: ${String(pong)}`);
    }
  }

  private async observeRedisCommand<T>(
    command: string,
    execute: () => Promise<T>,
    resolveOutcome: (result: T) => RedisOutcome = () => 'neutral',
  ): Promise<T> {
    const startedAt = Date.now();
    const result = await execute();
    const durationMs = Date.now() - startedAt;
    const outcome = resolveOutcome(result);

    recordRedisOperation({
      command,
      durationMs,
      outcome,
      slowThresholdMs: this.slowRedisThresholdMs,
    });

    if (this.slowRedisLogEnabled && durationMs >= this.slowRedisThresholdMs) {
      this.logger.warn(
        `[slow-redis] ${command} ${durationMs}ms outcome=${outcome}`,
      );
    }

    return result;
  }
}
