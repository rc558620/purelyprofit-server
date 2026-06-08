import { buildFinanceCashFlowPattern } from '../purely-profit/finance/finance.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  FinanceCacheInvalidatorInput,
  FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';

export const financeCashFlowCacheInvalidatorProvider: CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Pick<FinanceCacheInvalidatorRegistry, 'invalidateFinanceCashFlow'>
> = (input: FinanceCacheInvalidatorInput) => ({
  invalidateFinanceCashFlow: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(buildFinanceCashFlowPattern(storeId));
  },
});
