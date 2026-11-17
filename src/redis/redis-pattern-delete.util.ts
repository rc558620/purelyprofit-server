import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  isSimpleRedisGlob,
  pipelineUnlinkByPattern,
  pipelineUnlinkByPatterns,
} from './redis-pipeline.util';

/** 按模式删除时需要的观测上下文 */
export interface PatternDeleteOptions {
  logger: Logger;
  slowLogEnabled: boolean;
  slowThresholdMs: number;
}

/** 用 SCAN + pipeline UNLINK 删除单个模式命中的 key */
export const deleteByPattern = (
  client: Redis,
  pattern: string,
  options: PatternDeleteOptions,
): Promise<number> =>
  pipelineUnlinkByPattern(
    client,
    pattern,
    options.logger,
    options.slowLogEnabled,
    options.slowThresholdMs,
  );

/**
 * 一次 keyspace 遍历删除多个模式的 key。
 *
 * 仅含 `*` 的模式走合并路径；含 `?` / `[]` / `\` 的复杂模式分流回
 * deleteByPattern，由 Redis 服务端 MATCH 保证语义，避免客户端匹配分叉。
 */
export const deleteByPatterns = async (
  client: Redis,
  patterns: string[],
  options: PatternDeleteOptions,
): Promise<number> => {
  if (patterns.length === 0) {
    return 0;
  }

  const simple = patterns.filter(isSimpleRedisGlob);
  const complex = patterns.filter((pattern) => !isSimpleRedisGlob(pattern));

  const [simpleDeleted, complexDeleted] = await Promise.all([
    simple.length > 0
      ? pipelineUnlinkByPatterns(
          client,
          simple,
          options.logger,
          options.slowLogEnabled,
          options.slowThresholdMs,
        )
      : Promise.resolve(0),
    Promise.all(
      complex.map((pattern) => deleteByPattern(client, pattern, options)),
    ),
  ]);

  return simpleDeleted + complexDeleted.reduce((sum, count) => sum + count, 0);
};
