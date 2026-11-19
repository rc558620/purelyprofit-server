import {
  buildFinanceReconciliationsPattern,
  buildFinanceReconciliationsStatsCacheKey,
} from '../purely-profit/finance/finance.cache-keys';
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
    // stats key 没有尾段，pattern 覆盖不到，必须精确删除
    await Promise.all([
      input.redisService.del(buildFinanceReconciliationsStatsCacheKey(storeId)),
      input.redisService.delByPattern(
        buildFinanceReconciliationsPattern(storeId),
      ),
    ]);
  },
});
