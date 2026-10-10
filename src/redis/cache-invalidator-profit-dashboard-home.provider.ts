import {
  buildProfitDashboardHomeActivitiesCacheKey,
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
      input.redisService.delByPattern(buildProfitDashboardHomePattern(storeId)),
      input.redisService.delByPattern(
        buildProfitDashboardHomeChunkPattern(storeId),
      ),
      // 动态缓存键不带 period，chunk 通配模式匹配不到，需精确删除
      input.redisService.del(
        buildProfitDashboardHomeActivitiesCacheKey(storeId),
      ),
    ]);
  },
});
