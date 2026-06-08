import { buildFinanceOverviewPattern } from '../purely-profit/finance/finance.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  FinanceCacheInvalidatorInput,
  FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';

export const financeOverviewCacheInvalidatorProvider: CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Pick<FinanceCacheInvalidatorRegistry, 'invalidateFinanceOverview'>
> = (input: FinanceCacheInvalidatorInput) => ({
  invalidateFinanceOverview: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(buildFinanceOverviewPattern(storeId));
  },
});
