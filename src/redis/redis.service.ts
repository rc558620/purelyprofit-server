import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { recordRedisOperation } from '../observability';

type RedisOutcome = 'hit' | 'miss' | 'neutral';

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            const next = this.queue.shift();
            if (next) {
              next();
            }
          });
      };

      if (this.active < this.concurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  async drain(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

function countPipelineDeleted(
  results: Array<[Error | null, unknown]> | null,
): number {
  if (!results) {
    return 0;
  }

  let count = 0;
  for (const [err, value] of results) {
    if (!err && typeof value === 'number') {
      count += value;
    }
  }
  return count;
}

export interface RefreshableCachePayload<T> {
  generatedAt: number;
  refreshAt: number;
  data: T;
}

export interface RefreshableCacheLoadOptions<T> {
  cacheKey: string;
  taskKey: string;
  ttlSeconds: number;
  refreshAfterMs: number;
  loadValue: () => Promise<T>;
  refreshValue?: () => Promise<T>;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly slowRedisLogEnabled: boolean;
  private readonly slowRedisThresholdMs: number;
  private readonly backgroundRefreshTasks = new Map<string, Promise<void>>();
  private readonly refreshQueue: ConcurrencyLimiter;

  constructor(private readonly configService: ConfigService) {
    this.slowRedisLogEnabled =
      this.configService.get<boolean>('app.slowRedisLogEnabled') ?? true;
    this.slowRedisThresholdMs =
      this.configService.get<number>('app.slowRedisThresholdMs') ?? 20;
    const refreshConcurrency =
      this.configService.get<number>('app.cacheRefreshConcurrency') ?? 8;
    this.refreshQueue = new ConcurrencyLimiter(refreshConcurrency);
  }

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
      password: this.configService.get<string>('redis.password') || undefined,
      db: this.configService.get<number>('redis.db'),
      connectTimeout:
        this.configService.get<number>('redis.connectTimeoutMs') ?? 5_000,
      commandTimeout:
        this.configService.get<number>('redis.commandTimeoutMs') ?? 3_000,
      maxRetriesPerRequest:
        this.configService.get<number>('redis.maxRetriesPerRequest') ?? 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  async onModuleDestroy() {
    await this.refreshQueue.drain();
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
          totalDeleted += countPipelineDeleted(results);
          pendingOps = 0;
        }
      }
    } while (cursor !== '0');

    if (pendingOps > 0) {
      const results = await pipeline.exec();
      totalDeleted += countPipelineDeleted(results);
    }

    const durationMs = Date.now() - startedAt;
    recordRedisOperation({
      command: 'UNLINK',
      durationMs,
      outcome: totalDeleted > 0 ? 'hit' : 'miss',
      slowThresholdMs: this.slowRedisThresholdMs,
    });

    if (this.slowRedisLogEnabled && durationMs >= this.slowRedisThresholdMs) {
      console.warn(
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

  async getOrLoadRefreshableJson<T>(
    options: RefreshableCacheLoadOptions<T>,
  ): Promise<T> {
    const cachedValue = await this.getJson<unknown>(options.cacheKey);
    const normalizedCached = this.normalizeRefreshableCachePayload<T>(
      cachedValue,
      options.refreshAfterMs,
    );

    if (normalizedCached !== null) {
      if (normalizedCached.isLegacy) {
        this.runBackgroundRefresh(options.taskKey, async () => {
          await this.writeRefreshableJson(
            options.cacheKey,
            normalizedCached.payload.data,
            options.ttlSeconds,
            options.refreshAfterMs,
          );
        });
      } else {
        this.scheduleBackgroundRefresh(
          options.taskKey,
          normalizedCached.payload.refreshAt,
          async () => {
            const refreshedValue = await (
              options.refreshValue ?? options.loadValue
            )();
            await this.writeRefreshableJson(
              options.cacheKey,
              refreshedValue,
              options.ttlSeconds,
              options.refreshAfterMs,
            );
          },
        );
      }
      return normalizedCached.payload.data;
    }

    const loadedValue = await options.loadValue();
    await this.writeRefreshableJson(
      options.cacheKey,
      loadedValue,
      options.ttlSeconds,
      options.refreshAfterMs,
    );
    return loadedValue;
  }

  async writeRefreshableJson<T>(
    cacheKey: string,
    data: T,
    ttlSeconds: number,
    refreshAfterMs: number,
  ): Promise<RefreshableCachePayload<T>> {
    const now = Date.now();
    const payload: RefreshableCachePayload<T> = {
      generatedAt: now,
      refreshAt: now + Math.max(0, refreshAfterMs),
      data,
    };
    await this.setJson(cacheKey, payload, ttlSeconds);
    return payload;
  }

  private normalizeRefreshableCachePayload<T>(
    cachedValue: unknown,
    refreshAfterMs: number,
  ): {
    payload: RefreshableCachePayload<T>;
    isLegacy: boolean;
  } | null {
    if (cachedValue === null) {
      return null;
    }

    if (this.isRefreshableCachePayload<T>(cachedValue)) {
      return {
        payload: cachedValue,
        isLegacy: false,
      };
    }

    const now = Date.now();
    return {
      payload: {
        generatedAt: now,
        refreshAt: now + Math.max(0, refreshAfterMs),
        data: cachedValue as T,
      },
      isLegacy: true,
    };
  }

  private isRefreshableCachePayload<T>(
    value: unknown,
  ): value is RefreshableCachePayload<T> {
    if (value === null || typeof value !== 'object') {
      return false;
    }

    const payload = value as Record<string, unknown>;
    return (
      typeof payload.generatedAt === 'number' &&
      typeof payload.refreshAt === 'number' &&
      'data' in payload
    );
  }

  scheduleBackgroundRefresh(
    taskKey: string,
    refreshAt: number,
    handler: () => Promise<void>,
  ): void {
    if (refreshAt > Date.now()) {
      return;
    }

    this.runBackgroundRefresh(taskKey, handler);
  }

  runBackgroundRefresh(taskKey: string, handler: () => Promise<void>): void {
    if (this.backgroundRefreshTasks.has(taskKey)) {
      return;
    }

    const task = this.refreshQueue.run(async () => {
      try {
        await handler();
      } catch (error: unknown) {
        console.error(`[cache-refresh] ${taskKey} failed`, error);
      } finally {
        this.backgroundRefreshTasks.delete(taskKey);
      }
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
