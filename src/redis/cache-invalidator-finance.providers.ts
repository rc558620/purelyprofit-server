import { financeAccountsCacheInvalidatorProvider } from './cache-invalidator-finance-accounts.provider';
import { financeCashFlowCacheInvalidatorProvider } from './cache-invalidator-finance-cash-flow.provider';
import { financeOverviewCacheInvalidatorProvider } from './cache-invalidator-finance-overview.provider';
import { financeReportCacheInvalidatorProvider } from './cache-invalidator-finance-report.provider';
import { financeReconciliationsCacheInvalidatorProvider } from './cache-invalidator-finance-reconciliations.provider';
import {
  buildCacheInvalidatorRegistry,
  type CacheInvalidatorProvider,
} from './cache-invalidator.registry';
import type { RedisService } from './redis.service';

export type FinanceCacheInvalidatorInput = {
  redisService: Pick<RedisService, 'del' | 'delByPattern'>;
};

export type FinanceCacheInvalidatorRegistry = {
  invalidateFinanceOverview: (storeId: number) => Promise<void>;
  invalidateFinanceCashFlow: (storeId: number) => Promise<void>;
  invalidateFinanceAccounts: (storeId: number) => Promise<void>;
  invalidateFinanceReconciliations: (storeId: number) => Promise<void>;
  invalidateFinanceReport: (storeId: number) => Promise<void>;
};

const financeCacheInvalidatorProviders: readonly CacheInvalidatorProvider<
  FinanceCacheInvalidatorInput,
  Partial<FinanceCacheInvalidatorRegistry>
>[] = [
  financeOverviewCacheInvalidatorProvider,
  financeCashFlowCacheInvalidatorProvider,
  financeAccountsCacheInvalidatorProvider,
  financeReconciliationsCacheInvalidatorProvider,
  financeReportCacheInvalidatorProvider,
];

export function createFinanceCacheInvalidatorRegistry(
  input: FinanceCacheInvalidatorInput,
): FinanceCacheInvalidatorRegistry {
  return buildCacheInvalidatorRegistry<
    FinanceCacheInvalidatorInput,
    FinanceCacheInvalidatorRegistry
  >(financeCacheInvalidatorProviders, input);
}
