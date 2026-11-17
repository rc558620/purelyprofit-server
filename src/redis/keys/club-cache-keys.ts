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

/**
 * 菜单库存快照缓存 key（门店粒度，极短 TTL）。
 *
 * 菜单主体（分类 / 商品 / 规格 / 价格 / 上下架）按**静态内容指纹**长 TTL 缓存，
 * 库存与销量这类每笔订单都会变的列被拆出来，单独走本 key（5s）。
 *
 * 为什么要拆：库存预留会 bump 商品/规格的 `version`，若指纹含 version，一笔下单
 * 就会让整店菜单缓存 key 轮换，全店在线顾客同时 miss。拆开后菜单缓存只随
 * 「菜单结构 / 价格 / 上下架」变化，库存精度反而从分钟级提升到秒级。
 */
export function buildClubMenuStockCacheKey(storeId: number): string {
  return `club:menu-stock:store:${storeId}`;
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

// ── Club 充值套餐缓存键 ──

/**
 * 门店充值套餐缓存 key（门店粒度，60s 兜底 TTL）。
 *
 * 套餐列表来自 `marketing_promotions`（type=recharge_gift），是**低频变更、高频读取**
 * 的数据：C 端充值页首屏、下单校验、预览三处都要它。缓存空结果同样写入
 * （无活动门店返回默认套餐，这份默认列表本身也有效）。
 * 失效挂 invalidateMarketingOverview（活动创建/编辑/启停路径已调用）。
 */
export function buildClubRechargePackagesCacheKey(storeId: number): string {
  return `club:recharge-packages:store:${storeId}`;
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

// ── Club 每日签到缓存键 ──

/**
 * 签到活动配置缓存 key（门店粒度，短 TTL）。
 *
 * 首页 Hero 的签到入口每次进场都会读一次 `marketing_promotions`
 * （type=daily_check_in）来判定「活动是否可参与」，而该配置只在商家端改活动时
 * 变化。缓存后单店只留一条记录，命中即省一次 DB 查询。
 * 失效挂 invalidateMarketingOverview（活动新建 / 编辑 / 启停路径已调用）。
 */
export function buildClubCheckInPromotionCacheKey(storeId: number): string {
  return `club:check-in-promotion:store:${storeId}`;
}

/**
 * 签到状态缓存 key（门店 + 用户 + 上海自然日粒度，极短 TTL）。
 *
 * key 里带自然日：跨零点自动换 key，昨天的「已签到」结论不会污染今天。
 * 值只包含「服务端算好的签到结论 + 积分余额」，`serverTime` 命中时由调用方
 * 覆盖为当前时间，避免前端拿到滞后的服务器时间。
 * 失效挂 invalidateMarketingCustomerDerived（签到 / 充值 / 消费落账路径已调用）。
 */
export function buildClubCheckInStatusCacheKey(
  storeId: number,
  userId: number,
  checkInDate: string,
): string {
  return `club:check-in-status:store:${storeId}:user:${userId}:day:${checkInDate}`;
}

export function buildClubCheckInStatusPattern(storeId: number): string {
  return `club:check-in-status:store:${storeId}:user:*`;
}

// ── Club 首单资格缓存键 ──

/**
 * 「顾客是否已有消费记录」缓存 key（门店 + 顾客粒度，短 TTL）。
 *
 * 商品列表 / 详情 / 首页的定价上下文都要判定首单资格，原实现每个请求都跑一次
 * `marketing_consumptions` 的 findFirst。该结论一旦变为 true 不会再回到 false，
 * 因此缓存只会让「刚下单的顾客」在最多一个 TTL 内仍看到首单优惠。
 * 失效挂 invalidateMarketingCustomerDerived（消费落账路径已调用）。
 */
export function buildClubCustomerConsumptionExistsCacheKey(
  storeId: number,
  customerId: number,
): string {
  return `club:consumption-exists:store:${storeId}:customer:${customerId}`;
}

export function buildClubCustomerConsumptionExistsPattern(
  storeId: number,
): string {
  return `club:consumption-exists:store:${storeId}:customer:*`;
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
