import {
  buildCostsRecordsPattern,
  buildCostsStatsPattern,
  buildCostsReportPattern,
  buildCostsDashboardPattern,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const costsCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateCostsCaches'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateCostsCaches: async (storeId: number): Promise<void> => {
    // 4 个模式合并为一次 keyspace 遍历：原先 4 次 delByPattern 各跑一遍全库 SCAN，
    // 在 key 量大的实例上是成本写入延迟的主要来源。
    await input.redisService.delByPatterns([
      buildCostsStatsPattern(storeId),
      buildCostsReportPattern(storeId),
      buildCostsRecordsPattern(storeId),
      buildCostsDashboardPattern(storeId),
    ]);
  },
});
