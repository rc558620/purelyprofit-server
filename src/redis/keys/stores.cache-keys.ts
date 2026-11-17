/**
 * 门店域读缓存键。
 */

/**
 * 门店扩展字段（logo / 坐标 / 门店类型等）缓存 key（门店粒度，7 天）。
 *
 * 事实源是 `stores.profile_metadata` JSONB，Redis 仅作读取缓存：
 * 写路径 `persistStoreProfileMetadata` 双写同一 key。
 * C 端首页聚合会预取本 key（见 `ClubHomeService`），因此必须集中在这里定义，
 * 禁止在业务侧另拼字符串。
 */
export function buildStoreProfileMetadataCacheKey(storeId: number): string {
  return `stores:profile:${storeId}`;
}
