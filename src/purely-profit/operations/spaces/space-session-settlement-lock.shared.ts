import { randomUUID } from 'node:crypto';
import type { RedisService } from '../../../redis/redis.service';

const SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS = 30;

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
    .set(
      lockKey,
      token,
      'EX',
      SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS,
      'NX',
    );

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
