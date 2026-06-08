import { businessAnalysisCachePrewarmProvider } from './cache-prewarm-business-analysis.provider';
import type { CachePrewarmProfitReadCategoryConfigProvider } from './cache-prewarm.config.types';
import { profitDashboardHomeCachePrewarmProvider } from './cache-prewarm-profit-dashboard-home.provider';

export const profitReadCachePrewarmCategoryConfigProviders: readonly CachePrewarmProfitReadCategoryConfigProvider[] =
  [
    profitDashboardHomeCachePrewarmProvider,
    businessAnalysisCachePrewarmProvider,
  ];
