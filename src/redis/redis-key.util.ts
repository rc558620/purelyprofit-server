import type { RedisOpsContext, RedisOutcome } from './redis-command-observer';

/** MGET 命中率判定：全命中 hit，全未命中 miss，其余 neutral */
const resolveMultiValueOutcome = (results: (string | null)[]): RedisOutcome => {
  const hitCount = results.filter((value) => value !== null).length;
  if (hitCount === 0) {
    return 'miss';
  }

  return hitCount === results.length ? 'hit' : 'neutral';
};

/** 判断 key 是否存在 */
export const keyExists = (
  ops: RedisOpsContext,
  key: string,
): Promise<boolean> =>
  ops.observe(
    'EXISTS',
    async () => (await ops.client.exists(key)) === 1,
    (result) => (result ? 'hit' : 'miss'),
  );

/** 删除单个 key */
export const deleteKey = async (
  ops: RedisOpsContext,
  key: string,
): Promise<void> => {
  await ops.observe('DEL', async () => {
    await ops.client.del(key);
  });
};

/** 批量删除 key，返回实际删除数量；keys 为空时跳过 */
export const deleteKeys = (
  ops: RedisOpsContext,
  keys: string[],
): Promise<number> =>
  keys.length === 0
    ? Promise.resolve(0)
    : ops.observe('DEL', () => ops.client.del(...keys));

/** 批量读取原始字符串值；keys 为空时返回空数组 */
export const readStrings = (
  ops: RedisOpsContext,
  keys: string[],
): Promise<(string | null)[]> =>
  keys.length === 0
    ? Promise.resolve([])
    : ops.observe(
        'MGET',
        () => ops.client.mget(...keys),
        resolveMultiValueOutcome,
      );

/** 批量读取 JSON 值；对应 key 不存在的位置返回 null */
export const readJsonList = async <T>(
  ops: RedisOpsContext,
  keys: string[],
): Promise<(T | null)[]> => {
  const rawValues = await readStrings(ops, keys);

  return rawValues.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)));
};

/** 按模式 SCAN 遍历 key；limit 为返回数量上限 */
export const scanKeys = async (
  ops: RedisOpsContext,
  pattern: string,
  limit?: number,
): Promise<string[]> => {
  let cursor = '0';
  const keys: string[] = [];

  do {
    const [nextCursor, batchKeys] = await ops.observe('SCAN', () =>
      ops.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100),
    );
    cursor = nextCursor;
    keys.push(...batchKeys);

    if (limit !== undefined && keys.length >= limit) {
      return keys.slice(0, limit);
    }
  } while (cursor !== '0');

  return keys;
};
