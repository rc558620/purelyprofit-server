import { randomUUID } from 'node:crypto';
import type { RedisService } from '../../../redis/redis.service';

/**
 * 会话结账锁 TTL（秒）。
 *
 * 必须严格大于结账事务上限 `TX_TIMEOUT_LONG = 30s`：锁与事务不是同一时钟，
 * 若锁先过期，第二个请求会在第一个事务仍持有行锁时拿到会话锁并进入
 * 「FOR UPDATE 等待」，把本来串行的结账放大成锁等待 + 事务超时。
 * 取 60s = 2 × 事务上限，覆盖事务打满后仍有释放余量。
 */
const SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS = 60;

export interface SpaceSessionSettlementLock {
  key: string;
  token: string;
}

export async function acquireSettlementLock(
  redisService: RedisService,
  sessionId: number,
): Promise<SpaceSessionSettlementLock | null> {
  const token = randomUUID();
  const lockKey = `space:settlement:session:${sessionId}`;
  const result = await redisService
    .getClient()
    .set(lockKey, token, 'EX', SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS, 'NX');

  return result === 'OK'
    ? {
        key: lockKey,
        token,
      }
    : null;
}

export async function releaseSettlementLock(
  redisService: RedisService,
  lock: SpaceSessionSettlementLock,
): Promise<void> {
  await redisService.getClient().eval(
    `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
    1,
    lock.key,
    lock.token,
  );
}
