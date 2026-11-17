import type { CachePrewarmSelectionPolicy } from './cache-prewarm.types';

/**
 * 财务类缓存的预热收敛配额（唯一事实来源）。
 *
 * 为什么必须设上限：财务报表 / 概览的 key 由 period × year × customDate ×
 * rangeStart/End × scope 组合而成，自定义区间的组合数没有理论上限。而预热的
 * 语义是「扫到就重写」——每写一次 TTL 又被续上 120s，于是任何一个曾经被访问
 * 过的组合都会被永久续命并每 15s 重算一遍。组合数只增不减，DB 峰值随使用时长
 * 单调上升，最终表现为「越用越慢」。
 *
 * 配额取值依据（按合法组合数推）：
 * - 概览：周期 ∈ {today, week, month, quarter, year} × scope ∈ {owner, sub_account}
 *   = 10 个稳定组合，配 12 留 2 个余量；
 * - 报表：固定周期 5 个 + custom_month / custom_range × 2 scope，稳定组合约 14 个，
 *   配 16 留余量；超额的自定义区间仍可由用户访问时按需重建（120s TTL），
 *   只是不再被后台反复续命。
 *
 * 空闲阈值说明：Redis 的 OBJECT IDLETIME 会被「读」与「写」同时刷新，而预热本身
 * 每轮都会重写选中的 key，因此该阈值只对「已掉出配额的组合」生效——那正是需要
 * 收敛的对象。财务 key 的 TTL 只有 120s，掉出配额后通常先自然过期，本阈值是
 * TTL 策略调整后的兜底清理，不会误删仍在被访问的热 key。
 */
export const FINANCE_OVERVIEW_PREWARM_SELECTION: CachePrewarmSelectionPolicy = {
  maxKeysPerStore: 12,
  maxIdleSeconds: 3_600,
};

export const FINANCE_REPORT_PREWARM_SELECTION: CachePrewarmSelectionPolicy = {
  maxKeysPerStore: 16,
  maxIdleSeconds: 3_600,
};
