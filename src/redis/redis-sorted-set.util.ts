import type { RedisOpsContext } from './redis-command-observer';

/** 单个 sorted set 成员的写入参数；ttlSeconds 用于刷新整个键的过期时间 */
export interface SortedSetMemberInput {
  score: number;
  member: string;
  ttlSeconds?: number;
}

/** 写入 sorted set 成员，可选刷新 TTL（秒） */
export const addSortedMember = async (
  ops: RedisOpsContext,
  key: string,
  input: SortedSetMemberInput,
): Promise<void> => {
  await ops.observe('ZADD', async () => {
    await ops.client.zadd(key, input.score, input.member);
    if (input.ttlSeconds) {
      await ops.client.expire(key, input.ttlSeconds);
    }
  });
};

/** 按 rank 区间删除 sorted set 成员，返回删除数量 */
export const removeSortedByRank = (
  ops: RedisOpsContext,
  key: string,
  start: number,
  stop: number,
): Promise<number> =>
  ops.observe('ZREMRANGEBYRANK', () =>
    ops.client.zremrangebyrank(key, start, stop),
  );

/** 读取成员 score；成员不存在返回 null */
export const readSortedScore = (
  ops: RedisOpsContext,
  key: string,
  member: string,
): Promise<string | null> =>
  ops.observe(
    'ZSCORE',
    () => ops.client.zscore(key, member),
    (result) => (result === null ? 'miss' : 'hit'),
  );

/** 读取 sorted set 成员数量 */
export const readSortedCard = (
  ops: RedisOpsContext,
  key: string,
): Promise<number> => ops.observe('ZCARD', () => ops.client.zcard(key));

/** 按 rank 区间读取成员 */
export const readSortedRange = (
  ops: RedisOpsContext,
  key: string,
  start: number,
  stop: number,
): Promise<string[]> =>
  ops.observe('ZRANGE', () => ops.client.zrange(key, start, stop));
