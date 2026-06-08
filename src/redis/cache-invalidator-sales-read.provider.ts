import { buildSalesReportPattern, buildSalesStatsPattern } from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const salesReadCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateSalesReadCaches'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateSalesReadCaches: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.delByPattern(buildSalesStatsPattern(storeId)),
      input.redisService.delByPattern(buildSalesReportPattern(storeId)),
    ]);
  },
});
