/**
 * 缓存键共享工具函数
 *
 * 跨业务域复用的基础工具，消除各 cache-keys 文件中的重复定义。
 */

export function toCacheSegment(
  value: string | number | null | undefined,
): string {
  return encodeURIComponent(String(value ?? 'na'));
}

export function buildCacheRefreshTaskKey(cacheKey: string): string {
  return `refresh:${cacheKey}`;
}
