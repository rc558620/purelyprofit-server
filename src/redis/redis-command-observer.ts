import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { recordRedisOperation } from '../observability';

/** 命令结果判定，用于缓存命中率与慢命令埋点 */
export type RedisOutcome = 'hit' | 'miss' | 'neutral';

/** 慢命令观测配置，来源于 app.slowRedisLogEnabled / app.slowRedisThresholdMs */
export interface RedisObservationOptions {
  slowLogEnabled: boolean;
  slowThresholdMs: number;
}

/**
 * 命令执行上下文：底层 client + 统一埋点入口。
 *
 * 各命令分组（string / hash / set / zset / key）都以此为第一入参，
 * 避免把耗时埋点与慢日志重复写进每一个读写方法。
 */
export interface RedisOpsContext {
  readonly client: Redis;
  observe<T>(
    command: string,
    execute: () => Promise<T>,
    resolveOutcome?: (result: T) => RedisOutcome,
  ): Promise<T>;
}

/**
 * Redis 命令观测器：负责耗时埋点与慢命令告警。
 *
 * 从 RedisService 抽出，使服务本体只保留命令编排与连接生命周期职责。
 */
export class RedisCommandObserver {
  constructor(
    private readonly logger: Logger,
    private readonly options: RedisObservationOptions,
  ) {}

  async observe<T>(
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
      slowThresholdMs: this.options.slowThresholdMs,
    });

    if (
      this.options.slowLogEnabled &&
      durationMs >= this.options.slowThresholdMs
    ) {
      this.logger.warn(
        `[slow-redis] ${command} ${durationMs}ms outcome=${outcome}`,
      );
    }

    return result;
  }
}

/** 构造命令执行上下文，供 RedisService 在连接就绪后注入各命令分组 */
export const createRedisOpsContext = (
  client: Redis,
  observer: RedisCommandObserver,
): RedisOpsContext => ({
  client,
  observe: <T>(
    command: string,
    execute: () => Promise<T>,
    resolveOutcome?: (result: T) => RedisOutcome,
  ): Promise<T> => observer.observe(command, execute, resolveOutcome),
});
