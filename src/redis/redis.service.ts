import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { recordRedisOperation } from '../observability';

type RedisOutcome = 'hit' | 'miss' | 'neutral';

/**
 * 安全的 JSON 序列化，处理 BigInt 和 Prisma.Decimal 类型：
 * - BigInt → Number（若在安全整数范围内）否则转字符串
 * - Prisma.Decimal（duck-typing：有 toNumber 且非 Date/Array）→ Number
 * - Date → 保持原生行为（ISO 字符串）
 *
 * 采用两阶段策略：先深度遍历将 BigInt / Decimal 转为原生类型，
 * 再用原生 JSON.stringify 序列化。这是因为 JSON.stringify 的 replacer
 * 在遇到有 toJSON() 的对象时会先调用 toJSON()，导致无法在 replacer
 * 中拦截 Prisma.Decimal 转为 number。
 */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function normalizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    typeof (value as Record<string, unknown>).toNumber === 'function'
  ) {
    // Prisma.Decimal 或类似 Decimal 类型 → number
    try {
      return (value as { toNumber: () => number }).toNumber();
    } catch {
      return (value as { toString: () => string }).toString();
    }
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeForJson(v);
    }
    return result;
  }

  return value;
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private drainResolve: (() => void) | null = null;

  constructor(private readonly concurrency: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async (): Promise<void> => {
        this.active += 1;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.active -= 1;
          if (this.active === 0 && this.queue.length === 0) {
            this.drainResolve?.();
            this.drainResolve = null;
          } else {
            const next = this.queue.shift();
            if (next) {
              next();
            }
          }
        }
      };

      if (this.active < this.concurrency) {
        void execute();
      } else {
        this.queue.push(() => {
          void execute();
        });
      }
    });
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
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
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private readonly slowRedisLogEnabled: boolean;
  private readonly slowRedisThresholdMs: number;
  private readonly backgroundRefreshTasks = new Map<string, Promise<void>>();
  private readonly backgroundRefreshTimers = new Map<string, NodeJS.Timeout>();
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
      // 启用离线队列：Redis 断连期间命令排队，重连后自动发送，避免立即报超时
      enableOfflineQueue: true,
      // 自动重连策略：指数退避，最大 5 秒间隔
      // 返回 null 则放弃重连（不应在此场景使用）
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5_000);
        return delay;
      },
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
    for (const timer of this.backgroundRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.backgroundRefreshTimers.clear();
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
    const delayMs = refreshAt - Date.now();
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.backgroundRefreshTimers.delete(taskKey);
        this.runBackgroundRefresh(taskKey, handler);
      }, delayMs);
      timer.unref?.();
      this.backgroundRefreshTimers.set(taskKey, timer);
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
        this.logger.error(`[cache-refresh] ${taskKey} failed`, error);
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
      this.logger.warn(
        `[slow-redis] ${command} ${durationMs}ms outcome=${outcome}`,
      );
    }

    return result;
  }
}
