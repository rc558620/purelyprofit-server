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

/**
 * 空间类型列表：单门店一份，与查询参数无关（列表仅按 storeId 过滤）。
 *
 * 空间类型是低频变更的门店运营配置（仅主账号可增改删），
 * 采用短 TTL + 写路径主动失效，与看板同策略。
 */
export function buildSpaceTypesCacheKey(storeId: number): string {
  return `profit:space-types:store:${storeId}`;
}

export function buildSpaceTypesPattern(storeId: number): string {
  return `profit:space-types:store:${storeId}`;
}

/** 空间区域列表：与空间类型同源同策略（门店级低频运营配置）。 */
export function buildSpaceZonesCacheKey(storeId: number): string {
  return `profit:space-zones:store:${storeId}`;
}

export function buildSpaceZonesPattern(storeId: number): string {
  return `profit:space-zones:store:${storeId}`;
}
