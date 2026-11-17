import type { RedisOpsContext } from './redis-command-observer';
import { safeJsonStringify } from './redis-json.util';
import { executeWritePipeline } from './redis-pipeline.util';

/** 单个 hash 字段的写入参数；ttlSeconds 用于刷新整键过期时间 */
export interface HashJsonWriteInput {
  field: string;
  value: unknown;
  ttlSeconds?: number;
}

/** 读取 hash 字段的 JSON 值；字段不存在返回 null */
export const readHashJson = async <T>(
  ops: RedisOpsContext,
  key: string,
  field: string,
): Promise<T | null> => {
  const raw = await ops.observe(
    'HGET',
    () => ops.client.hget(key, field),
    (result) => (result === null ? 'miss' : 'hit'),
  );
  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as T;
};

/**
 * 写入 hash 字段并可选刷新整个键的 TTL。
 *
 * HSET 与 EXPIRE 走同一条 pipeline：分开执行是两次往返，
 * 写路径并发量高时这两次往返是纯粹的浪费。
 */
export const writeHashJson = async (
  ops: RedisOpsContext,
  key: string,
  input: HashJsonWriteInput,
): Promise<void> => {
  await ops.observe('PIPELINE', () =>
    executeWritePipeline(ops.client, (pipeline) => {
      pipeline.hset(key, input.field, safeJsonStringify(input.value));
      if (input.ttlSeconds) {
        pipeline.expire(key, input.ttlSeconds);
      }
    }),
  );
};

/**
 * 读取 hash 多个字段的 JSON 值。
 *
 * 用于「一个键里按维度分字段缓存」的场景（如门店下各筛选组合的列表总数）：
 * 一次往返取回全部字段，缺失的字段由调用方回源。
 */
export const readHashJsonAll = async <T>(
  ops: RedisOpsContext,
  key: string,
): Promise<Record<string, T>> => {
  const raw = await ops.observe(
    'HGETALL',
    () => ops.client.hgetall(key),
    (result) => (Object.keys(result).length === 0 ? 'miss' : 'hit'),
  );
  const parsed: Record<string, T> = {};
  for (const [field, value] of Object.entries(raw)) {
    parsed[field] = JSON.parse(value) as T;
  }

  return parsed;
};
