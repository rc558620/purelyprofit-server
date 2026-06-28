import { businessAnalysisCacheInvalidatorProvider } from './cache-invalidator-business-analysis.provider';
import { costsCacheInvalidatorProvider } from './cache-invalidator-costs.provider';
import { marketingOverviewCacheInvalidatorProvider } from './cache-invalidator-marketing-overview.provider';
import { buildCacheInvalidatorRegistry } from './cache-invalidator.registry';
import { profitDashboardHomeCacheInvalidatorProvider } from './cache-invalidator-profit-dashboard-home.provider';
import { profitDetailCacheInvalidatorProvider } from './cache-invalidator-profit-detail.provider';
import { salesReadCacheInvalidatorProvider } from './cache-invalidator-sales-read.provider';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type { RedisService } from './redis.service';

export type ProfitReadCacheInvalidatorInput = {
  redisService: Pick<RedisService, 'del' | 'delByPattern'>;
};

export type ProfitReadCacheInvalidatorRegistry = {
  invalidateProfitDashboardHome: (storeId: number) => Promise<void>;
  invalidateBusinessAnalysis: (storeId: number) => Promise<void>;
  invalidateMarketingOverview: (storeId: number) => Promise<void>;
  invalidateSalesReadCaches: (storeId: number) => Promise<void>;
  invalidateProfitDetail: (storeId: number) => Promise<void>;
  invalidateCostsCaches: (storeId: number) => Promise<void>;
};

const profitReadCacheInvalidatorProviders: readonly CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Partial<ProfitReadCacheInvalidatorRegistry>
>[] = [
  profitDashboardHomeCacheInvalidatorProvider,
  businessAnalysisCacheInvalidatorProvider,
  marketingOverviewCacheInvalidatorProvider,
  salesReadCacheInvalidatorProvider,
  profitDetailCacheInvalidatorProvider,
  costsCacheInvalidatorProvider,
];

export function createProfitReadCacheInvalidatorRegistry(
  input: ProfitReadCacheInvalidatorInput,
): ProfitReadCacheInvalidatorRegistry {
  return buildCacheInvalidatorRegistry<
    ProfitReadCacheInvalidatorInput,
    ProfitReadCacheInvalidatorRegistry
  >(profitReadCacheInvalidatorProviders, input);
}
