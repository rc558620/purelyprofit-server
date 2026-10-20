import { toCacheSegment } from '../cache-keys.shared';

/**
 * 空间管理读侧缓存键（看板 + 空间列表）。
 *
 * 与 sales-stats 同策略：短 TTL + 后台刷新 + 写路径按 pattern 失效，
 * 属于「有界陈旧」缓存，最强一致读数不要走这里。
 */

type SpacesListCacheQuery = {
  status?: string;
  type?: string;
  zone?: string;
};

/** 空间看板：单门店一份，与查询参数无关（看板不接收筛选参数）。 */
export function buildSpacesDashboardCacheKey(storeId: number): string {
  return `profit:spaces:dashboard:store:${storeId}`;
}

export function buildSpacesDashboardPattern(storeId: number): string {
  return `profit:spaces:dashboard:store:${storeId}`;
}

/** 空间列表：按门店 + 筛选参数（status/type/zone）分键。 */
export function buildSpacesListCacheKey(
  storeId: number,
  query: SpacesListCacheQuery,
): string {
  return [
    'profit:spaces:list',
    `store:${storeId}`,
    `status:${toCacheSegment(query.status)}`,
    `type:${toCacheSegment(query.type)}`,
    `zone:${toCacheSegment(query.zone)}`,
  ].join(':');
}

export function buildSpacesListPattern(storeId: number): string {
  return `profit:spaces:list:store:${storeId}:*`;
}
