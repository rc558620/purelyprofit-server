import {
  buildProfitDashboardHomeActivitiesLivePattern,
  buildProfitDashboardHomeActivitiesStablePattern,
  buildProfitDashboardHomeChunkPattern,
  buildProfitDashboardHomePattern,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const profitDashboardHomeCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateProfitDashboardHome'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateProfitDashboardHome: async (storeId: number): Promise<void> => {
    await Promise.all([
      // 动态块键里带业务日，chunk 的 `period` 通配匹配不到，按前缀模式一并清掉
      input.redisService.delByPatterns([
        buildProfitDashboardHomePattern(storeId),
        buildProfitDashboardHomeChunkPattern(storeId),
        buildProfitDashboardHomeActivitiesLivePattern(storeId),
        buildProfitDashboardHomeActivitiesStablePattern(storeId),
      ]),
    ]);
  },
});
