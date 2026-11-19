import {
  buildFinanceAccountsPattern,
  buildFinanceAccountsStatsCacheKey,
} from '../purely-profit/finance/finance.cache-keys';
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
    // stats key 没有尾段，pattern 覆盖不到，必须精确删除
    await Promise.all([
      input.redisService.del(buildFinanceAccountsStatsCacheKey(storeId)),
      input.redisService.delByPattern(buildFinanceAccountsPattern(storeId)),
    ]);
  },
});
