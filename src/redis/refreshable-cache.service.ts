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
  /**
   * 未命中路径的并发去重（singleflight）：同一 cacheKey 的在途 load 共用一个 Promise。
   *
   * 没有去重时，N 个并发未命中会各自执行一次 loadValue + 一次写回。营销概览的
   * loadValue 内部有 10 个 Prisma 查询（含重聚合），缓存刚失效或首次访问时，
   * 商家端一次页面加载的多个并行请求会把这份重查询放大 N 倍，直接冲击 DB。
   */
  private readonly inflightLoads = new Map<string, Promise<unknown>>();
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

    const inflight = this.inflightLoads.get(options.cacheKey);
    if (inflight) {
      return inflight as Promise<T>;
    }

    const loadTask = this.loadAndWrite(options).finally(() => {
      this.inflightLoads.delete(options.cacheKey);
    });
    this.inflightLoads.set(options.cacheKey, loadTask);

    return loadTask;
  }

  private async loadAndWrite<T>(
    options: RefreshableCacheLoadOptions<T>,
  ): Promise<T> {
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
    await this.redisService.setJson(
      cacheKey,
      payload,
      this.applyTtlJitter(ttlSeconds),
    );
    return payload;
  }

  /**
   * 给 TTL 加 ±10% 随机抖动。
   *
   * 预热任务会集中创建一批 key，TTL 完全相同时它们会在同一秒集体失效，
   * 造成周期性穿透（营销概览一次 load 就是 10 个查询）。抖动把失效时刻摊开。
   * 抖动幅度远小于 refreshAfterMs 的提前刷新窗口，不影响后台刷新节奏。
   */
  private applyTtlJitter(ttlSeconds: number): number {
    if (ttlSeconds <= 0) {
      return ttlSeconds;
    }

    return Math.max(1, Math.round(ttlSeconds * (0.9 + Math.random() * 0.2)));
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
