import { buildMarketingOverviewCacheKey } from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const marketingOverviewCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateMarketingOverview'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateMarketingOverview: async (storeId: number): Promise<void> => {
    await input.redisService.del(buildMarketingOverviewCacheKey(storeId));
  },
});
