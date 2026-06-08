import { buildFinanceAccountsPattern } from '../purely-profit/finance/finance.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  FinanceCacheInvalidatorInput,
  FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';

export const financeAccountsCacheInvalidatorProvider: CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Pick<FinanceCacheInvalidatorRegistry, 'invalidateFinanceAccounts'>
> = (input: FinanceCacheInvalidatorInput) => ({
  invalidateFinanceAccounts: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(buildFinanceAccountsPattern(storeId));
  },
});
