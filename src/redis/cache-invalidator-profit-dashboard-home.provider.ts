import {
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
    ]);
  },
});
