import { buildFinanceReconciliationsPattern } from '../purely-profit/finance/finance.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  FinanceCacheInvalidatorInput,
  FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';

export const financeReconciliationsCacheInvalidatorProvider: CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Pick<FinanceCacheInvalidatorRegistry, 'invalidateFinanceReconciliations'>
> = (input: FinanceCacheInvalidatorInput) => ({
  invalidateFinanceReconciliations: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(
      buildFinanceReconciliationsPattern(storeId),
    );
  },
});
