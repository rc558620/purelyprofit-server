/**
 * Club 建单链路「并行执行 + 按声明顺序结算」helper（性能批次 · 串行 await 并行化）。
 *
 * 为什么不用 `Promise.all`：all 抛的是「谁先失败」，错误码优先级会随机器负载漂移。
 * 建单链路改前是串行 await，语义是**声明顺序优先**（例如「门店会员到期」必须先于
 * 「商品不存在」返回，「新客额度用尽」必须先于算价异常返回），前端按错误码分支，
 * 一旦优先级漂移就是行为回归。
 *
 * 为什么不用 Promise 的 then / catch 链，也不用「裸并行 + 后置 await」：
 *   - 规范 §二 禁止 promise 链式调用（统一 async/await）；
 *   - 裸并行时若先失败的任务从未被 await（另一条分支先抛出），就是未处理 rejection，
 *     Node 默认 `--unhandled-rejections=throw` 会直接崩进程。
 * `Promise.allSettled` 是唯一既保序又不会漏接 rejection 的写法。
 *
 * 代价（已知并接受）：失败路径要等所有分支落地才抛出，比串行慢一点点；
 * 成功路径省掉的是真正串行的整段往返，收益远大于该代价。
 */

/** 两个任务：按声明顺序结算，第一个失败者抛出 */
export function settleClubTasksInOrder<T1, T2>(
  tasks: readonly [Promise<T1>, Promise<T2>],
): Promise<[T1, T2]>;
/** 三个任务：按声明顺序结算，第一个失败者抛出 */
export function settleClubTasksInOrder<T1, T2, T3>(
  tasks: readonly [Promise<T1>, Promise<T2>, Promise<T3>],
): Promise<[T1, T2, T3]>;
export async function settleClubTasksInOrder(
  tasks: readonly Promise<unknown>[],
): Promise<unknown[]> {
  const results = await Promise.allSettled(tasks);
  const values: unknown[] = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      // 保持与串行 await 一致的错误优先级：按声明顺序抛第一个失败
      throw result.reason;
    }
    values.push(result.value);
  }

  return values;
}
