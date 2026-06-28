/**
 * 并发控制工具函数。
 *
 * 用于替代 Promise.all(arr.map(async ...)) 模式，限制同时执行的 Promise 数量，
 * 防止大量并行数据库操作打满 Prisma 连接池。
 */

/**
 * 对数组元素执行异步映射，限制最大并发数。
 *
 * @param items - 待处理的数组
 * @param fn - 异步映射函数
 * @param concurrency - 最大并发数（默认 8，通常不超过 Prisma 连接池大小）
 * @returns 与输入数组顺序一致的结果数组
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 8,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
