import type { RedisOpsContext } from './redis-command-observer';

/**
 * 执行 Lua 脚本（EVAL）。
 *
 * 仅用于「读 → 判断 → 写」必须原子的场景（并发抢占、条件更新）。
 * 用 SET NX / GET 后再写会留出竞态窗口：两个终端同时读到 failed，
 * 随后各自写 pending，都会获得下发资格，最终同一张票重复出纸。
 */
export const runScript = (
  ops: RedisOpsContext,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> =>
  ops.observe('EVAL', () =>
    ops.client.eval(script, keys.length, ...keys, ...args),
  );
