import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { recordRedisOperation } from '../observability';

type RedisOutcome = 'hit' | 'miss' | 'neutral';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly slowRedisLogEnabled: boolean;
  private readonly slowRedisThresholdMs: number;
  private readonly backgroundRefreshTasks = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {
    this.slowRedisLogEnabled =
      this.configService.get<boolean>('app.slowRedisLogEnabled') ?? true;
    this.slowRedisThresholdMs =
      this.configService.get<number>('app.slowRedisThresholdMs') ?? 20;
  }

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
      password: this.configService.get<string>('redis.password') || undefined,
      db: this.configService.get<number>('redis.db'),
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

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
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
    const keys = await this.scanKeysByPattern(pattern);
    return this.delMany(keys);
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

  runBackgroundRefresh(taskKey: string, handler: () => Promise<void>): void {
    if (this.backgroundRefreshTasks.has(taskKey)) {
      return;
    }

    const task = handler()
      .catch((error: unknown) => {
        console.error(`[cache-refresh] ${taskKey} failed`, error);
      })
      .finally(() => {
        this.backgroundRefreshTasks.delete(taskKey);
      });

    this.backgroundRefreshTasks.set(taskKey, task);
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
      console.warn(
        `[slow-redis] ${command} ${durationMs}ms outcome=${outcome}`,
      );
    }

    return result;
  }
}
