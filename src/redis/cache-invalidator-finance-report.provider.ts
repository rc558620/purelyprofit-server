import { buildFinanceReportPattern } from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  FinanceCacheInvalidatorInput,
  FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';

export const financeReportCacheInvalidatorProvider: CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Pick<FinanceCacheInvalidatorRegistry, 'invalidateFinanceReport'>
> = (input: FinanceCacheInvalidatorInput) => ({
  invalidateFinanceReport: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(buildFinanceReportPattern(storeId));
  },
});
