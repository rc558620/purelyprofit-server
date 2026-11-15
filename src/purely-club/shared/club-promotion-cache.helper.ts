/**
 * C 端活动缓存：TTL 口径与进程内 singleflight 的公共实现。
 *
 * 为什么需要「边界感知」的 TTL：两份活动缓存（定价投影 + 展示列表）缓存的都是
 * 「按 now 过滤后的生效活动」。若用固定 60s TTL，到点边界必然给出错误结论：
 *  - 11:59:50 写入的列表里含 12:00 结束的活动 → 12:00:30 仍按它打折/展示；
 *  - 12:00 才开始的活动 → 12:00:59 之前都看不到。
 * 因此 TTL 必须被「最近的活动边界」截断：缓存活不到任何边界之后。
 *
 * 口径：TTL = clamp(ceil(最近的开始/结束边界 - now), 下限 1s, 上限 60s)
 *  - 上限沿用改造前的 60s：无边界门店（空活动/长周期活动）仍需一个兜底刷新，
 *    覆盖「将来新增的活动写路径漏挂失效」；
 *  - 下限 1s：`RedisService.set` 的 `if (ttlSeconds)` 会把 0 当成「不设 TTL」，
 *    0 / 负数必须先夹到 1，否则缓存永不过期。
 *
 * 精度：边界处最多 1s 误差（秒级 TTL + ceil），满足「到点即生效 / 即失效」。
 */

/** 无边界可截断时的兜底 TTL（秒），与改造前保持一致 */
export const CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS = 60;

/** 下限 1s，见文件头「RedisService.set 把 0 当不设 TTL」的说明 */
const CLUB_PROMOTION_CACHE_MIN_TTL_SECONDS = 1;

/** 参与边界计算的最小字段集（只读时间窗，不关心其它业务字段） */
export interface ClubPromotionTimeWindow {
  startAt: Date;
  endAt: Date;
}

/**
 * 计算「本次查询结果」这份缓存能存活多久。
 *
 * 入参必须是**查询时取回的全部候选活动**（含尚未开始的），否则算不出「开始」边界。
 * 已结束的活动（endAt <= now）不参与边界计算，它本来就不该出现在缓存里。
 */
export function resolveClubPromotionCacheTtlSeconds(
  promotions: readonly ClubPromotionTimeWindow[],
  nowMs: number,
): number {
  let nextBoundaryMs = Number.POSITIVE_INFINITY;

  for (const promotion of promotions) {
    const startMs = promotion.startAt.getTime();
    const endMs = promotion.endAt.getTime();
    // 未开始的活动关心「开始」边界，已开始的关心「结束」边界
    const boundaryMs = startMs > nowMs ? startMs : endMs;
    if (boundaryMs > nowMs && boundaryMs < nextBoundaryMs) {
      nextBoundaryMs = boundaryMs;
    }
  }

  if (!Number.isFinite(nextBoundaryMs)) {
    return CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS;
  }

  const seconds = Math.ceil((nextBoundaryMs - nowMs) / 1000);
  return Math.min(
    Math.max(seconds, CLUB_PROMOTION_CACHE_MIN_TTL_SECONDS),
    CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS,
  );
}

/**
 * 进程内并发去重（singleflight）。
 *
 * 缓存未命中时同一 key 的并发请求共用一次回源，避免活动列表被并发放大
 * （首页 + 商品页同时进入时最容易触发）。集群下最多放大到 worker 数。
 * 调用方各自持有 Map：去重范围是进程内，与既有 menu / product 缓存实现一致。
 */
export function runClubPromotionSingleflight<T>(
  inflight: Map<string, Promise<T>>,
  cacheKey: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = load().finally(() => {
    inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, task);
  return task;
}
