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

/**
 * 菜单版本缓存 key（门店粒度，短 TTL）。
 *
 * menuVersion 需要一次四层 JOIN 才能算出，而它又是菜单缓存 key 的组成
 * 部分——不缓存时每次菜单请求都要先跑这条最重的 SQL，即使菜单缓存命中。
 * 缓存 TTL 很短（见 CLUB_MENU_VERSION_CACHE_TTL_SECONDS），并且菜单写路径
 * 会主动删除（见 products-scan-ordering-sync / 下单预留库存），
 * 因此不会延长菜单变更的可见延迟。
 */
export function buildClubMenuVersionCacheKey(storeId: number): string {
  return `club:menu-version:store:${storeId}`;
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

/**
 * C 端活动列表缓存 key（门店粒度）。
 *
 * 与 buildClubPromotionsCacheKey 区分：后者只缓存定价所需的 4 类折扣活动
 * （见 ClubPromotionRepository），这里缓存 C 端首页/活动页展示用的全量字段，
 * 两者形状不同不能共键。失效同样挂在活动写路径上。
 */
export function buildClubPromotionListCacheKey(storeId: number): string {
  return `club:promotions:store:${storeId}:list`;
}

// ── Club 服务商品读缓存键 ──

/**
 * 商品版本缓存 key（门店粒度，短 TTL）。
 *
 * 版本由「上架商品数 + 最大 updatedAt」聚合得出，改价 / 上下架 / 库存变动
 * 都会改变它，进而让列表与详情 key 自动切换，旧 key 自然过期。这样无需在
 * B 端商品 CRUD 与 C 端下单 / 退款等写路径上逐一挂失效钩子。
 */
export function buildClubProductsVersionCacheKey(storeId: number): string {
  return `club:products-version:store:${storeId}`;
}

/**
 * 商品列表缓存 key：门店 + 版本 + 过滤 / 分页维度。
 * 带 keyword 的查询不走缓存（用户输入使 key 空间无限且命中率低）。
 */
export function buildClubProductListCacheKey(
  storeId: number,
  version: string,
  params: { categoryId?: number; cursor?: number; take?: number },
): string {
  const category = params.categoryId ?? 0;
  const cursor = params.cursor ?? 0;
  const take = params.take ?? 0;
  return `club:products:store:${storeId}:v:${version}:cat:${category}:cursor:${cursor}:take:${take}`;
}

/** 商品详情缓存 key：门店 + 版本 + 商品 ID。 */
export function buildClubProductDetailCacheKey(
  storeId: number,
  version: string,
  productId: number,
): string {
  return `club:products:store:${storeId}:v:${version}:detail:${productId}`;
}
