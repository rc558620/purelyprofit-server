import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConcurrencyLimiter } from './concurrency-limiter.util';
import type {
  RefreshableCacheLoadOptions,
  RefreshableCachePayload,
} from './refreshable-cache.types';
import { RedisService } from './redis.service';

@Injectable()
export class RefreshableCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RefreshableCacheService.name);
  private readonly backgroundRefreshTasks = new Map<string, Promise<void>>();
  private readonly backgroundRefreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly refreshQueue: ConcurrencyLimiter;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    const refreshConcurrency =
      this.configService.get<number>('app.cacheRefreshConcurrency') ?? 8;
    this.refreshQueue = new ConcurrencyLimiter(refreshConcurrency);
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.backgroundRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.backgroundRefreshTimers.clear();
    await this.refreshQueue.drain();
  }

  /**
   * 读-改-写缓存：命中直接返回，未命中则 load 后写回。
   *
   * ⚠️ 一致性边界：loadValue 与写回之间若发生写请求（提交后按 pattern 失效），
   * 本次 load 读到的旧值仍会被写回并存活一个 TTL（refreshAfterMs 之后由后台
   * 刷新自愈）。因此本缓存是「有界陈旧」而非强一致：商家端对 C 端刚落账的
   * 余额/积分，最坏滞后约 ttlSeconds，通常在 refreshAfterMs 后自行纠正。
   * 需要强一致的读数（余额、库存）不要走这里。
   */
  async getOrLoadRefreshableJson<T>(
    options: RefreshableCacheLoadOptions<T>,
  ): Promise<T> {
    const cachedValue = await this.redisService.getJson<unknown>(
      options.cacheKey,
    );
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
    await this.redisService.setJson(cacheKey, payload, ttlSeconds);
    return payload;
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
}
