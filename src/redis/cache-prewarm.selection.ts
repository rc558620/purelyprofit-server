import type { CachePrewarmSelectionPolicy } from './cache-prewarm.types';

/** 空闲时间未知时的占位值：视为「刚刚访问过」，避免误删仍在被读的 key */
const UNKNOWN_IDLE_SECONDS = 0;

export type CachePrewarmKeySelectionResult = {
  /** 本轮实际预热的 key */
  selected: string[];
  /** 空闲超阈值、本轮需要直接删除的冷 key */
  evictedForIdle: string[];
  /** 超出单店配额被本轮跳过（仍留在 Redis，由 TTL / 内存淘汰处理）的 key 数 */
  droppedByStoreCap: number;
  /** 无法解析门店、未参与收敛的 key 数（原样保留预热） */
  unresolvedCount: number;
};

/**
 * 按「门店配额 + 最近访问」收敛一轮预热 key（纯函数，不持有 IO 依赖）。
 *
 * 排序口径：空闲秒数升序（越近被读过越优先），同空闲时间按 key 字典序，
 * 保证同样输入下每轮选中的集合稳定，不会因为 Map 迭代顺序抖动而在两轮之间来回换血。
 *
 * 边界：
 * - `maxKeysPerStore <= 0` 视为不限流（保留全部候选）；
 * - `maxIdleSeconds <= 0` 视为关闭空闲清理；
 * - 解析不出门店的 key 一律保留并独立预热，宁可多算一次也不静默丢热数据。
 */
export function selectCachePrewarmKeys(params: {
  cacheKeys: readonly string[];
  resolveStoreId: (cacheKey: string) => number | null;
  policy: CachePrewarmSelectionPolicy;
  idleSecondsByKey: ReadonlyMap<string, number>;
}): CachePrewarmKeySelectionResult {
  const { cacheKeys, resolveStoreId, policy, idleSecondsByKey } = params;
  const storeGroups = new Map<number, string[]>();
  const unresolvedKeys: string[] = [];

  for (const cacheKey of cacheKeys) {
    const storeId = resolveStoreId(cacheKey);
    if (storeId === null) {
      unresolvedKeys.push(cacheKey);
      continue;
    }
    const group = storeGroups.get(storeId);
    if (group) {
      group.push(cacheKey);
    } else {
      storeGroups.set(storeId, [cacheKey]);
    }
  }

  const selected: string[] = [];
  const evictedForIdle: string[] = [];
  let droppedByStoreCap = 0;

  for (const group of storeGroups.values()) {
    const candidates: string[] = [];

    for (const cacheKey of group) {
      const idleSeconds =
        idleSecondsByKey.get(cacheKey) ?? UNKNOWN_IDLE_SECONDS;
      if (policy.maxIdleSeconds > 0 && idleSeconds >= policy.maxIdleSeconds) {
        evictedForIdle.push(cacheKey);
        continue;
      }
      candidates.push(cacheKey);
    }

    const ranked = candidates
      .map((cacheKey) => ({
        cacheKey,
        idleSeconds: idleSecondsByKey.get(cacheKey) ?? UNKNOWN_IDLE_SECONDS,
      }))
      .sort(
        (left, right) =>
          left.idleSeconds - right.idleSeconds ||
          left.cacheKey.localeCompare(right.cacheKey),
      );

    const limit =
      policy.maxKeysPerStore > 0 ? policy.maxKeysPerStore : ranked.length;
    for (const item of ranked.slice(0, limit)) {
      selected.push(item.cacheKey);
    }
    droppedByStoreCap += Math.max(0, ranked.length - limit);
  }

  return {
    selected: [...selected, ...unresolvedKeys],
    evictedForIdle,
    droppedByStoreCap,
    unresolvedCount: unresolvedKeys.length,
  };
}
