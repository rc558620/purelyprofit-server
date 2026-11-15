/**
 * Club 批处理「有限并发」执行器（3-B-7）。
 *
 * 解决的问题：后台批处理（充值超时关单、充值跨天对账）此前是
 * `for (const item of batch) { await wxCall(item) }`，逐笔串行打微信支付 HTTP。
 * 单笔请求含网络往返（超时上限 8s），串行跑到批次尾部时总耗时可能超过
 * 分布式锁 TTL，导致锁提前失效、另一个实例抢先跑同一批订单。
 *
 * 为什么不直接 `Promise.all(items.map(handler))`：批次上限可达 200 笔，
 * 一次性打满会同时压微信支付接口（单商户号限流）、DB 连接池与私钥加载。
 * 这里用固定大小的 worker 池，任意时刻在途请求数不超过 `concurrency`。
 *
 * 错误契约（与规范 §十二 一致，**不吞异常**）：
 *  - 单笔失败不会中断其它笔（批处理必须跑完整批）；
 *  - 全部跑完后，若存在未被 handler 自行处理的异常，抛出第一个交给调用方。
 *    因此 handler 若希望「单笔失败只记日志」，必须自己 catch（两个调用方均如此）。
 */

/**
 * 默认并发度。
 *
 * 取 5 的权衡：微信支付 API v3 对单商户号有频率限制，后台任务不应抢占
 * 前台支付/查单的配额；同时 5 路已能把 200 笔批次的耗时从分钟级压到十秒级。
 * 调高前必须先确认商户号配额与 DB 连接池余量。
 */
export const CLUB_BATCH_DEFAULT_CONCURRENCY = 5;

/**
 * 以有限并发依次处理批次内的每一项。
 *
 * @param items 待处理批次（只读，不会被修改）
 * @param handler 单项处理器；返回值被忽略，单笔异常应自行 catch
 * @param concurrency 最大在途数量，非法值（NaN / ≤0）等价于 1
 */
export async function runClubBatchWithConcurrency<T>(
  items: readonly T[],
  handler: (item: T, index: number) => Promise<void>,
  concurrency: number = CLUB_BATCH_DEFAULT_CONCURRENCY,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  // 并发度不需要超过待处理条目数，也不允许出现 0 / NaN 导致 worker 空转
  const limit = Math.min(
    Math.max(1, Number.isFinite(concurrency) ? Math.trunc(concurrency) : 1),
    items.length,
  );
  let cursor = 0;
  /** 未被 handler 自行处理的异常（按出现顺序），全部跑完后抛第一个 */
  const failures: unknown[] = [];

  const worker = async (): Promise<void> => {
    // cursor 单线程自增，无竞态：每个索引只会被一个 worker 取到
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await handler(items[index], index);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (failures.length > 0) {
    throw failures[0];
  }
}
