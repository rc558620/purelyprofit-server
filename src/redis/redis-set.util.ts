import type { RedisOpsContext } from './redis-command-observer';

/**
 * 向 set 中添加成员，可选刷新 TTL（秒）。
 *
 * 原子操作，适用于「并发写入不能丢」的索引场景（如 refresh token 索引）。
 */
export const addSetMember = async (
  ops: RedisOpsContext,
  key: string,
  member: string,
  ttlSeconds?: number,
): Promise<void> => {
  await ops.observe('SADD', async () => {
    await ops.client.sadd(key, member);
    if (ttlSeconds) {
      await ops.client.expire(key, ttlSeconds);
    }
  });
};

/** 批量向 set 中添加成员，可选刷新 TTL（秒）；members 为空时跳过 */
export const addSetMembers = async (
  ops: RedisOpsContext,
  key: string,
  members: string[],
  ttlSeconds?: number,
): Promise<void> => {
  if (members.length === 0) {
    return;
  }

  await ops.observe('SADD', async () => {
    await ops.client.sadd(key, ...members);
    if (ttlSeconds) {
      await ops.client.expire(key, ttlSeconds);
    }
  });
};

/** 读取 set 全部成员；key 不存在时返回空数组 */
export const readSetMembers = (
  ops: RedisOpsContext,
  key: string,
): Promise<string[]> => ops.observe('SMEMBERS', () => ops.client.smembers(key));

/** 从 set 中移除成员（原子操作）；members 为空时跳过 */
export const removeSetMembers = async (
  ops: RedisOpsContext,
  key: string,
  members: string[],
): Promise<void> => {
  if (members.length === 0) {
    return;
  }

  await ops.observe('SREM', async () => {
    await ops.client.srem(key, ...members);
  });
};
