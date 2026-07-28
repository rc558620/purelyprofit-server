import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { recordRedisOperation } from '../observability';
import { pipelineUnlinkByPattern } from './redis-pipeline.util';
import { safeJsonStringify } from './redis-json.util';
import { buildRedisConnectionOptions } from '../shared/redis-connection.utils';

type RedisOutcome = 'hit' | 'miss' | 'neutral';

@Injectable()
export class RedisService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
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

  onModuleInit(): void {
    this.client = this.createClient();

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

  async onApplicationBootstrap(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  isReady(): boolean {
    return this.client.status === 'ready';
  }

  isConnectionClosedError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Connection is closed.';
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

  async publish(channel: string, message: string): Promise<number> {
    return this.observeRedisCommand('PUBLISH', () =>
      this.client.publish(channel, message),
    );
  }

  createPubSubClients(): { publisher: Redis; subscriber: Redis } {
    return {
      publisher: this.client.duplicate(),
      subscriber: this.client.duplicate(),
    };
  }

  async subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const subscriber = this.client.duplicate();
    const handleMessage = (receivedChannel: string, message: string): void => {
      if (receivedChannel === channel) listener(message);
    };
    subscriber.on('error', (error: Error) => {
      this.logger.error(
        `[redis] subscriber error: ${error.message}`,
        error.stack,
      );
    });
    subscriber.on('message', handleMessage);
    await subscriber.subscribe(channel);
    return async () => {
      subscriber.off('message', handleMessage);
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    };
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

  /**
   * 设置 key 的过期时间（秒）。
   * @returns 若 key 存在且 TTL 设置成功返回 true，key 不存在返回 false
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return this.observeRedisCommand('EXPIRE', async () => {
      const result = await this.client.expire(key, ttlSeconds);
      return result === 1;
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

  /**
   * 原子获取并删除 key（使用 Redis GETDEL 命令）。
   *
   * 将 GET + DEL 合并为单条原子命令，消除并发场景下
   * "先读后删" 导致的 TOCTOU 竞态条件（如 refresh token 轮换）。
   *
   * @returns 解析后的 JSON 值；key 不存在时返回 null
   */
  async getJsonAndDelete<T>(key: string): Promise<T | null> {
    const raw = await this.observeRedisCommand(
      'GETDEL',
      () => this.client.getdel(key),
      (result) => (result === null ? 'miss' : 'hit'),
    );
    if (raw === null) return null;
    return JSON.parse(raw) as T;
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
    return pipelineUnlinkByPattern(
      this.client,
      pattern,
      this.logger,
      this.slowRedisLogEnabled,
      this.slowRedisThresholdMs,
    );
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

  // ── Sorted Set 操作 ─────────────────────────────────────

  async zadd(
    key: string,
    score: number,
    member: string,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.observeRedisCommand('ZADD', async () => {
      await this.client.zadd(key, score, member);
      if (ttlSeconds) {
        await this.client.expire(key, ttlSeconds);
      }
    });
  }

  async zremrangebyrank(
    key: string,
    start: number,
    stop: number,
  ): Promise<number> {
    return this.observeRedisCommand('ZREMRANGEBYRANK', () =>
      this.client.zremrangebyrank(key, start, stop),
    );
  }

  async zscore(key: string, member: string): Promise<string | null> {
    return this.observeRedisCommand(
      'ZSCORE',
      () => this.client.zscore(key, member),
      (result) => (result === null ? 'miss' : 'hit'),
    );
  }

  async zcard(key: string): Promise<number> {
    return this.observeRedisCommand('ZCARD', () => this.client.zcard(key));
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.observeRedisCommand('ZRANGE', () =>
      this.client.zrange(key, start, stop),
    );
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    return this.observeRedisCommand(
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
  }

  async checkReadiness(): Promise<void> {
    const pong = await this.observeRedisCommand('PING', () =>
      this.client.ping(),
    );
    if (pong !== 'PONG') {
      throw new Error(`unexpected redis ping response: ${String(pong)}`);
    }
  }

  private createClient(): Redis {
    const redisOptions = buildRedisConnectionOptions(this.configService);
    const commandTimeout =
      this.configService.get<number>('redis.commandTimeoutMs') ?? 3_000;
    return new Redis({ ...redisOptions, commandTimeout });
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
