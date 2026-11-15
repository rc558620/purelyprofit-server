/**
 * 积分配置（`marketing_member_level_settings.points_ratio`）进程内短 TTL 缓存。
 *
 * 为什么需要：算价与展示链路（商品详情首屏 bootstrap、订单预览、积分规则接口）
 * 每次都要读同一行配置。实测同一次首屏请求会读两次：一次供 `pointsRatio`
 * 展示，一次供 preview 计算抵扣——两次都是同一行、同一列。
 *
 * 边界（资金安全优先）：
 * - **只供展示 / 预览路径**使用。创建订单与结算属于资金口径，必须直读，
 *   由调用方显式传 `useCache` 决定，本模块不提供默认开启。
 * - TTL 取 5s：后台调整抵扣比例后，C 端最迟 5s 内按新口径展示；真正扣减
 *   仍以交易事务内重新校验为准，缓存不会成为资金依据。
 * - 进程内而非 Redis：配置是「单行主键读 + 极低频写」，进程内缓存不引入
 *   额外失效链路，Redis 故障也不会放大成配置不可用。
 */

/** 缓存有效期（毫秒） */
export const CLUB_POINTS_CONFIG_CACHE_TTL_MS = 5_000;

/** 条目上限：门店数增长时避免 Map 无界占用 */
export const CLUB_POINTS_CONFIG_CACHE_MAX_STORES = 1_000;

/** 积分配置回源结果：原始 JSON + 活动覆盖标记（两者共同决定 enabled） */
export interface ClubPointsRatioSource {
  /** `points_ratio` 原始 JSON，解析口径由调用方决定（抵扣 / 获得） */
  pointsRatio: unknown;
  /** 是否存在生效中的 `points_recharge` 活动（用于 enabled 覆盖） */
  hasPointsRechargePromo: boolean;
}

interface ClubPointsConfigCacheEntry {
  source: ClubPointsRatioSource;
  cachedAt: number;
}

/**
 * 门店粒度积分配置 TTL 缓存 + 在途去重。
 *
 * 在途去重解决的是「同一瞬间的并发请求同时未命中」：首页 / 商品页会并行发出
 * 多个接口，逐个回源等于把同一次查询放大成 N 次。
 */
export class ClubPointsConfigCache {
  private readonly entries = new Map<number, ClubPointsConfigCacheEntry>();
  private readonly inflight = new Map<number, Promise<ClubPointsRatioSource>>();

  constructor(
    private readonly ttlMs: number = CLUB_POINTS_CONFIG_CACHE_TTL_MS,
    private readonly maxStores: number = CLUB_POINTS_CONFIG_CACHE_MAX_STORES,
  ) {}

  /** 命中返回缓存值，未命中或已过期返回 null */
  get(storeId: number): ClubPointsRatioSource | null {
    const entry = this.entries.get(storeId);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.cachedAt >= this.ttlMs) {
      this.entries.delete(storeId);
      return null;
    }

    return entry.source;
  }

  set(storeId: number, source: ClubPointsRatioSource): void {
    if (this.entries.size >= this.maxStores) {
      this.prune(Date.now());
      if (this.entries.size >= this.maxStores) {
        const oldestStoreId = this.entries.keys().next().value;
        if (oldestStoreId !== undefined) {
          this.entries.delete(oldestStoreId);
        }
      }
    }

    this.entries.set(storeId, { source, cachedAt: Date.now() });
  }

  /** 清除指定门店（写路径主动失效时调用） */
  delete(storeId: number): void {
    this.entries.delete(storeId);
  }

  /** 清空（测试与运维排查用；业务上靠 TTL 自然过期） */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /**
   * 命中缓存直接返回；未命中时把并发的同门店请求合并成一次回源。
   *
   * 回源失败不写缓存：缓存只做加速，不允许把一次数据库异常固化 5s。
   */
  async remember(
    storeId: number,
    load: () => Promise<ClubPointsRatioSource>,
  ): Promise<ClubPointsRatioSource> {
    const cached = this.get(storeId);
    if (cached) {
      return cached;
    }

    const inflight = this.inflight.get(storeId);
    if (inflight) {
      return inflight;
    }

    const request = this.loadAndCache(storeId, load);
    this.inflight.set(storeId, request);
    return request;
  }

  /** 回源 + 写缓存 + 清在途标记；失败不写缓存，仅释放在途槽位 */
  private async loadAndCache(
    storeId: number,
    load: () => Promise<ClubPointsRatioSource>,
  ): Promise<ClubPointsRatioSource> {
    try {
      const source = await load();
      this.set(storeId, source);
      return source;
    } finally {
      this.inflight.delete(storeId);
    }
  }

  private prune(now: number): void {
    for (const [storeId, entry] of this.entries) {
      if (now - entry.cachedAt >= this.ttlMs) {
        this.entries.delete(storeId);
      }
    }
  }
}
