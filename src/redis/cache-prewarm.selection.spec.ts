import { selectCachePrewarmKeys } from './cache-prewarm.selection';

/** 从 `...:store:<id>:...` 段解析门店，模拟财务 key 的形态 */
const resolveStoreId = (cacheKey: string): number | null => {
  const match = /:store:(\d+):/.exec(cacheKey);
  return match ? Number(match[1]) : null;
};

const buildKey = (storeId: number, period: string): string =>
  `profit:finance:report:store:${storeId}:scope:owner:period:${period}`;

describe('缓存预热 key 收敛', () => {
  it('按门店配额截断，超额的组合不再每轮重算', () => {
    const cacheKeys = [
      buildKey(1, 'today'),
      buildKey(1, 'week'),
      buildKey(1, 'month'),
      buildKey(2, 'today'),
      buildKey(2, 'week'),
    ];

    const result = selectCachePrewarmKeys({
      cacheKeys,
      resolveStoreId,
      policy: { maxKeysPerStore: 2, maxIdleSeconds: 0 },
      idleSecondsByKey: new Map(),
    });

    expect(result.selected).toHaveLength(4);
    expect(result.droppedByStoreCap).toBe(1);
    expect(result.evictedForIdle).toEqual([]);
    expect(result.selected).toContain(buildKey(2, 'week'));
  });

  it('最近访问的组合优先保留，空闲最久的先被挤出配额', () => {
    const cacheKeys = [
      buildKey(1, 'today'),
      buildKey(1, 'week'),
      buildKey(1, 'month'),
    ];

    const result = selectCachePrewarmKeys({
      cacheKeys,
      resolveStoreId,
      policy: { maxKeysPerStore: 2, maxIdleSeconds: 0 },
      idleSecondsByKey: new Map([
        [buildKey(1, 'today'), 300],
        [buildKey(1, 'week'), 5],
        [buildKey(1, 'month'), 60],
      ]),
    });

    expect(result.selected).toEqual([
      buildKey(1, 'week'),
      buildKey(1, 'month'),
    ]);
    expect(result.droppedByStoreCap).toBe(1);
  });

  it('空闲超阈值的 key 判定为冷 key 并进入清理列表', () => {
    const cacheKeys = [buildKey(1, 'today'), buildKey(1, 'custom_range')];

    const result = selectCachePrewarmKeys({
      cacheKeys,
      resolveStoreId,
      policy: { maxKeysPerStore: 10, maxIdleSeconds: 3_600 },
      idleSecondsByKey: new Map([
        [buildKey(1, 'today'), 10],
        [buildKey(1, 'custom_range'), 7_200],
      ]),
    });

    expect(result.selected).toEqual([buildKey(1, 'today')]);
    expect(result.evictedForIdle).toEqual([buildKey(1, 'custom_range')]);
  });

  it('解析不出门店的 key 原样保留，不做静默丢弃', () => {
    const result = selectCachePrewarmKeys({
      cacheKeys: ['profit:finance:report:unparsable'],
      resolveStoreId,
      policy: { maxKeysPerStore: 1, maxIdleSeconds: 3_600 },
      idleSecondsByKey: new Map(),
    });

    expect(result.selected).toEqual(['profit:finance:report:unparsable']);
    expect(result.unresolvedCount).toBe(1);
  });

  it('空闲时间未知时按刚访问过处理，避免误删仍在被读的 key', () => {
    const cacheKeys = [buildKey(1, 'today')];

    const result = selectCachePrewarmKeys({
      cacheKeys,
      resolveStoreId,
      policy: { maxKeysPerStore: 10, maxIdleSeconds: 3_600 },
      idleSecondsByKey: new Map(),
    });

    expect(result.evictedForIdle).toEqual([]);
    expect(result.selected).toEqual(cacheKeys);
  });
});
