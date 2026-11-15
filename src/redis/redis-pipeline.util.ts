import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { recordRedisOperation } from '../observability';
import { countPipelineDeleted } from './concurrency-limiter.util';

/**
 * 项目内缓存失效 pattern 只使用 `*` 通配符（见 src/redis/keys/*）。
 * 含 `?` / `[]` / `\` 的复杂模式不走合并路径，仍由 Redis 服务端 MATCH 处理，
 * 避免客户端匹配与 Redis glob 语义分叉。
 */
export const isSimpleRedisGlob = (pattern: string): boolean =>
  !pattern.includes('?') &&
  !pattern.includes('[') &&
  !pattern.includes(']') &&
  !pattern.includes('\\');

/** 把仅含 `*` 的 Redis glob 编译成 RegExp：其余正则元字符一律转义。 */
export const compileSimpleRedisGlob = (pattern: string): RegExp => {
  const body = pattern
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`);
};

/**
 * 使用 SCAN + pipeline UNLINK 按模式批量删除 key。
 *
 * 将 scan 遍历与 pipeline 批量 unlink 解耦为独立工具函数，
 * 供 RedisService.delByPattern 委托调用。
 */
export async function pipelineUnlinkByPattern(
  client: Redis,
  pattern: string,
  logger: Logger,
  slowRedisLogEnabled: boolean,
  slowRedisThresholdMs: number,
): Promise<number> {
  const startedAt = Date.now();
  let cursor = '0';
  let totalDeleted = 0;
  const pipelineBatchSize = 200;
  const pipeline = client.pipeline();
  let pendingOps = 0;

  do {
    const [nextCursor, batchKeys] = await client.scan(
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
          logger.warn(
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
      logger.warn(
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
    slowThresholdMs: slowRedisThresholdMs,
  });

  if (slowRedisLogEnabled && durationMs >= slowRedisThresholdMs) {
    logger.warn(
      `[slow-redis] UNLINK ${durationMs}ms pattern=${pattern} deleted=${totalDeleted}`,
    );
  }

  return totalDeleted;
}

/**
 * 一次 SCAN 遍历删除多个模式命中的 key。
 *
 * Redis 的 `SCAN MATCH` 只能接一个模式，而一次落账会连续触发 7 个模式，
 * 每个模式都要完整遍历一遍 keyspace。这里改成不带 MATCH 的一次遍历 +
 * 客户端按多个已编译模式过滤，删除集合与逐模式扫描完全一致，但只遍历 1 次。
 * 复杂模式由 RedisService 分流回 pipelineUnlinkByPattern，不在此处理。
 */
export async function pipelineUnlinkByPatterns(
  client: Redis,
  patterns: string[],
  logger: Logger,
  slowRedisLogEnabled: boolean,
  slowRedisThresholdMs: number,
): Promise<number> {
  const startedAt = Date.now();
  const matchers = patterns.map(compileSimpleRedisGlob);
  const label = patterns.join(',');
  const pipelineBatchSize = 200;
  const pipeline = client.pipeline();
  let cursor = '0';
  let totalDeleted = 0;
  let pendingOps = 0;

  const flush = async (): Promise<void> => {
    const results = await pipeline.exec();
    if (results === null) {
      logger.warn(
        `[redis] pipeline.exec() returned null during delByPatterns patterns=${label}`,
      );
    } else {
      totalDeleted += countPipelineDeleted(results);
    }
    pendingOps = 0;
  };

  do {
    const [nextCursor, batchKeys] = await client.scan(cursor, 'COUNT', 100);
    cursor = nextCursor;

    for (const key of batchKeys) {
      if (!matchers.some((matcher) => matcher.test(key))) continue;
      pipeline.unlink(key);
      pendingOps += 1;
      if (pendingOps >= pipelineBatchSize) await flush();
    }
  } while (cursor !== '0');

  if (pendingOps > 0) await flush();

  const durationMs = Date.now() - startedAt;
  recordRedisOperation({
    command: 'UNLINK',
    durationMs,
    outcome: totalDeleted > 0 ? 'hit' : 'miss',
    slowThresholdMs: slowRedisThresholdMs,
  });

  if (slowRedisLogEnabled && durationMs >= slowRedisThresholdMs) {
    logger.warn(
      `[slow-redis] UNLINK ${durationMs}ms patterns=${label} deleted=${totalDeleted}`,
    );
  }

  return totalDeleted;
}
