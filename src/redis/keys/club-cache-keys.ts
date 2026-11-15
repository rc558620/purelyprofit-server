/**
 * purelyClub 端读缓存键（菜单 / 会员快照 / 活动促销）。
 *
 * 这些 key 均为短 TTL、用户/门店级粒度，不注册到 prewarm-cycle。
 * 失效策略复用既有 invalidator provider（见 cache-invalidator-marketing-*）。
 */

// ── Club 菜单缓存键 ──

/**
 * 菜单缓存 key。
 * menuVersion 是基于分类/商品/规格组/规格项 ID+version+上下架的 content-hash
 * （库内 md5，32 位十六进制），菜单变更后 menuVersion 自动变化 → key 自动变化
 * → 旧 key 自然过期。前端不解析该值，只当不透明字符串使用。
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

// ── Club 自助下单菜单缓存键 ──

/**
 * 自助下单菜单缓存 key（门店粒度，短 TTL）。
 *
 * 与扫码点餐菜单不同：自助下单菜单直接来自商品库，menuVersion 可由回源数据
 * 一并算出并随响应缓存，无需额外跑一次版本聚合查询，因此不做版本化 key。
 * 会话门禁不进缓存（会话状态必须实时校验），菜单数据才进缓存。
 */
export function buildClubSelfOrderingMenuCacheKey(storeId: number): string {
  return `club:self-ordering-menu:store:${storeId}`;
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
 * 门店当前生效活动列表缓存 key（门店粒度，定价投影：4 类折扣活动）。
 *
 * TTL 不固定：由最近的活动开始/结束边界截断（上限 60s），保证到点即生效/即失效，
 * 见 `resolveClubPromotionCacheTtlSeconds`。失效挂 invalidateMarketingOverview，
 * 与新补充的 `:list` 展示缓存**成对删除**。
 */
export function buildClubPromotionsCacheKey(storeId: number): string {
  return `club:promotions:store:${storeId}`;
}

export function buildClubPromotionsPattern(storeId: number): string {
  return `club:promotions:store:${storeId}`;
}

/**
 * C 端活动列表缓存 key（门店粒度，展示口径：全量字段）。
 *
 * 与 buildClubPromotionsCacheKey 区分：后者只缓存定价所需的 4 类折扣活动
 * （见 ClubPromotionRepository），这里缓存 C 端首页/活动页展示用的全量字段，
 * 两者形状不同不能共键。两份 key 必须**成对失效**，否则会出现「展示已更新、
 * 结算仍按旧活动打折」这类口径分裂（见 marketingOverviewCacheInvalidatorProvider）。
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
