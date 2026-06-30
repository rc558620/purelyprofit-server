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
    await Promise.all([
      input.redisService.delByPattern(buildCostsStatsPattern(storeId)),
      input.redisService.delByPattern(buildCostsReportPattern(storeId)),
      input.redisService.delByPattern(buildCostsRecordsPattern(storeId)),
      input.redisService.delByPattern(buildCostsDashboardPattern(storeId)),
    ]);
  },
});
