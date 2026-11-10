import { toCacheSegment } from '../cache-keys.shared';

/**
 * 商家端商品分类列表读缓存键。
 *
 * 与 purelyClub 菜单缓存同策略：key 内置门店分类数据版本，版本由一次轻量
 * 聚合（MAX(updated_at) / MAX(id) / COUNT）得出。分类增删改、商品写路径
 * 隐式建分类都会改变版本 → 自动换 key，因此无需注册失效 provider，
 * 正常写入后立刻可读到新列表；极端同毫秒重复写由短 TTL 兜底。
 *
 * 旧版本 key 由短 TTL 自然回收，不进 prewarm-cycle。
 */

export function buildCategoriesListCacheKey(
  storeId: number,
  version: string,
  keyword?: string,
): string {
  return [
    'profit:categories:list',
    `store:${storeId}`,
    `v:${toCacheSegment(version)}`,
    `kw:${toCacheSegment(keyword)}`,
  ].join(':');
}

/** 供运维按门店清理分类列表缓存；正常读写不依赖它，靠版本换 key 自愈。 */
export function buildCategoriesListPattern(storeId: number): string {
  return `profit:categories:list:store:${storeId}:*`;
}
