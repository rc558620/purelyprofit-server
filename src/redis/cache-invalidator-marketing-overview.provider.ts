import { buildMarketingOverviewCacheKey } from './cache-keys';
import { buildClubPromotionsCacheKey } from './keys/club-cache-keys';
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
    await Promise.all([
      input.redisService.del(buildMarketingOverviewCacheKey(storeId)),
      // club 活动促销缓存（club:promotions:store:{storeId}）
      input.redisService.del(buildClubPromotionsCacheKey(storeId)),
    ]);
  },
});
