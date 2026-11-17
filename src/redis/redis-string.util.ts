import type { RedisOpsContext } from './redis-command-observer';
import { safeJsonStringify } from './redis-json.util';

/** 读取字符串值；key 不存在返回 null */
export const readString = (
  ops: RedisOpsContext,
  key: string,
): Promise<string | null> =>
  ops.observe(
    'GET',
    () => ops.client.get(key),
    (result) => (result === null ? 'miss' : 'hit'),
  );

/** 读取 JSON 值并反序列化；key 不存在返回 null */
export const readJson = async <T>(
  ops: RedisOpsContext,
  key: string,
): Promise<T | null> => {
  const rawValue = await readString(ops, key);
  if (rawValue === null) {
    return null;
  }

  return JSON.parse(rawValue) as T;
};

/** 写入字符串值，可选 TTL（秒） */
export const writeString = async (
  ops: RedisOpsContext,
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> => {
  await ops.observe('SET', async () => {
    if (ttlSeconds) {
      await ops.client.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await ops.client.set(key, value);
  });
};

/** 写入 JSON 值，可选 TTL（秒） */
export const writeJson = async (
  ops: RedisOpsContext,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> => {
  await writeString(ops, key, safeJsonStringify(value), ttlSeconds);
};

/**
 * 原子递增 key 对应的值，key 不存在时从 0 开始递增（结果为 1）。
 *
 * 仅在 key 首次创建（结果为 1）时设置 TTL，避免覆盖已有过期时间。
 */
export const incrementCounter = (
  ops: RedisOpsContext,
  key: string,
  ttlSecondsOnCreate?: number,
): Promise<number> =>
  ops.observe('INCR', async () => {
    const result = await ops.client.incr(key);
    if (result === 1 && ttlSecondsOnCreate) {
      await ops.client.expire(key, ttlSecondsOnCreate);
    }
    return result;
  });

/** 设置 key 的过期时间（秒）；key 不存在返回 false */
export const expireKey = (
  ops: RedisOpsContext,
  key: string,
  ttlSeconds: number,
): Promise<boolean> =>
  ops.observe('EXPIRE', async () => {
    const result = await ops.client.expire(key, ttlSeconds);
    return result === 1;
  });

/** 仅当 key 不存在时写入（SET NX EX）；已存在返回 false */
export const setKeyIfAbsent = (
  ops: RedisOpsContext,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> =>
  ops.observe(
    'SET',
    async () => {
      const result = await ops.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    },
    (result) => (result ? 'hit' : 'miss'),
  );

/**
 * 原子获取并删除 key（GETDEL）。
 *
 * 将 GET + DEL 合并为单条原子命令，消除并发场景下「先读后删」的
 * TOCTOU 竞态（如 refresh token 轮换）。
 */
export const readJsonAndDelete = async <T>(
  ops: RedisOpsContext,
  key: string,
): Promise<T | null> => {
  const raw = await ops.observe(
    'GETDEL',
    () => ops.client.getdel(key),
    (result) => (result === null ? 'miss' : 'hit'),
  );
  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as T;
};
