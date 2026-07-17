import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { recordRedisOperation } from '../observability';
import { countPipelineDeleted } from './concurrency-limiter.util';

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
