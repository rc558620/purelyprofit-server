/**
 * purelyClub 端读缓存键（菜单 / 会员快照 / 活动促销）。
 *
 * 这些 key 均为短 TTL、用户/门店级粒度，不注册到 prewarm-cycle。
 * 失效策略复用既有 invalidator provider（见 cache-invalidator-marketing-*）。
 */

// ── Club 菜单缓存键 ──

/**
 * 菜单缓存 key。
 * menuVersion 是基于分类/商品 ID+version 的 content-hash，
 * 菜单变更后 menuVersion 自动变化 → key 自动变化 → 旧 key 自然过期。
 */
export function buildClubMenuCacheKey(
  storeId: number,
  menuVersion: string,
): string {
  return `club:menu:store:${storeId}:v:${menuVersion}`;
}

export function buildClubMenuPattern(storeId: number): string {
  return `club:menu:store:${storeId}:v:*`;
}

// ── Club 会员快照缓存键 ──

/**
 * 会员快照缓存 key（门店 + 用户粒度）。
 * 失效挂 invalidateMarketingCustomerDerived（C 端落账路径已调用）。
 */
export function buildClubMemberSnapshotCacheKey(
  storeId: number,
  userId: number,
): string {
  return `club:member-snapshot:store:${storeId}:user:${userId}`;
}

export function buildClubMemberSnapshotPattern(storeId: number): string {
  return `club:member-snapshot:store:${storeId}:user:*`;
}

// ── Club 活动促销缓存键 ──

/**
 * 门店当前生效活动列表缓存 key（门店粒度）。
 * 失效挂 invalidateMarketingOverview（活动创建/编辑/启停路径已调用）。
 */
export function buildClubPromotionsCacheKey(storeId: number): string {
  return `club:promotions:store:${storeId}`;
}

export function buildClubPromotionsPattern(storeId: number): string {
  return `club:promotions:store:${storeId}`;
}
