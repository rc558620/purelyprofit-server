/**
 * 会员等级配置进程内 TTL 缓存（3-B-2）。
 *
 * 为什么做进程内而不是 Redis：等级配置是「单行主键读 + 极低频写」的配置数据，
 * 进程内缓存不新增任何外部依赖与失效链路——Redis 故障、多实例删 key 竞态
 * 这类问题从根上不存在。代价是可见延迟固定为 TTL 上限（多实例各自计时）。
 *
 * ⚠️ 只缓存 `levels`（等级展示与折扣率）。同一行的 `pointsRatio` 属于资金口径
 * （积分抵扣比例 / 赠送比例），必须保持每次直读，禁止并入本缓存。
 *
 * ⚠️ 缓存值内部数组**不可被调用方修改**：`get` 返回的内部引用只在 service 内
 * 使用，对外一律经 {@link cloneLevelSettings} 拷贝后返回。
 */

import type { MarketingMemberLevelConfigValue } from '../../../purely-profit/marketing/marketing.utils';

/**
 * 缓存有效期（毫秒）。
 *
 * 取 3s 的依据：与既有 C 端可见延迟基线（会员快照 15s、商品 30s、活动 1~60s）
 * 同量级但更短；后台改完等级折扣率后，C 端最迟 3s 内按新口径展示与定价。
 */
export const CLUB_LEVEL_SETTINGS_CACHE_TTL_MS = 3_000;

/** 缓存条目上限：门店数增长时避免 Map 无界占用（超限先清过期项，再淘汰最早写入项） */
export const CLUB_LEVEL_SETTINGS_CACHE_MAX_STORES = 1_000;

interface ClubLevelSettingsCacheEntry {
  levels: MarketingMemberLevelConfigValue[];
  cachedAt: number;
}

/** 门店粒度等级配置 TTL 缓存（每个 service 实例一份） */
export class ClubLevelSettingsTtlCache {
  private readonly entries = new Map<number, ClubLevelSettingsCacheEntry>();

  constructor(
    private readonly ttlMs: number = CLUB_LEVEL_SETTINGS_CACHE_TTL_MS,
    private readonly maxStores: number = CLUB_LEVEL_SETTINGS_CACHE_MAX_STORES,
  ) {}

  /** 命中返回内部引用（调用方必须先拷贝），未命中或已过期返回 null */
  get(storeId: number): MarketingMemberLevelConfigValue[] | null {
    const entry = this.entries.get(storeId);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.cachedAt >= this.ttlMs) {
      this.entries.delete(storeId);
      return null;
    }

    return entry.levels;
  }

  set(storeId: number, levels: MarketingMemberLevelConfigValue[]): void {
    if (this.entries.size >= this.maxStores) {
      this.prune(Date.now());
      if (this.entries.size >= this.maxStores) {
        const oldestStoreId = this.entries.keys().next().value;
        if (oldestStoreId !== undefined) {
          this.entries.delete(oldestStoreId);
        }
      }
    }

    this.entries.set(storeId, { levels, cachedAt: Date.now() });
  }

  /** 清空（测试与运维排查用；业务上不主动失效，靠 TTL 自然过期） */
  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [storeId, entry] of this.entries) {
      if (now - entry.cachedAt >= this.ttlMs) {
        this.entries.delete(storeId);
      }
    }
  }
}

/** 返回浅层副本（数组 + 每个元素），避免调用方修改污染缓存 */
export function cloneLevelSettings(
  levels: MarketingMemberLevelConfigValue[],
): MarketingMemberLevelConfigValue[] {
  return levels.map((level) => ({ ...level }));
}
