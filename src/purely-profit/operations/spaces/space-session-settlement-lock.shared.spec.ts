import { aUuid } from '../../../spec-matchers';
import type { RedisService } from '../../../redis/redis.service';
import { acquireSettlementLock } from './space-session-settlement-lock.shared';

describe('space-session-settlement-lock.shared', () => {
  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };
  const redisService = {
    getClient: jest.fn(() => redisClient),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('会话结账锁 TTL 必须大于事务上限（TX_TIMEOUT_LONG 30s），取 60s', async () => {
    redisClient.set.mockResolvedValue('OK');

    const lock = await acquireSettlementLock(
      redisService as unknown as RedisService,
      9,
    );

    expect(lock).not.toBeNull();
    expect(lock?.key).toBe('space:settlement:session:9');
    expect(redisClient.set).toHaveBeenCalledWith(
      'space:settlement:session:9',
      aUuid,
      'EX',
      60,
      'NX',
    );
  });

  it('锁已被持有时返回 null，由调用方抛冲突而不是等待', async () => {
    redisClient.set.mockResolvedValue(null);

    const lock = await acquireSettlementLock(
      redisService as unknown as RedisService,
      9,
    );

    expect(lock).toBeNull();
  });
});
