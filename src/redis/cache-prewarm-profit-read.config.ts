import { businessAnalysisCachePrewarmProvider } from './cache-prewarm-business-analysis.provider';
import type { CachePrewarmProfitReadCategoryConfigProvider } from './cache-prewarm.config.types';
import { marketingOverviewCachePrewarmProvider } from './cache-prewarm-marketing-overview.provider';
import { membersMetaCachePrewarmProvider } from './cache-prewarm-members-meta.provider';
import { membersOverviewCachePrewarmProvider } from './cache-prewarm-members-overview.provider';
import { profitDashboardHomeCachePrewarmProvider } from './cache-prewarm-profit-dashboard-home.provider';

export const profitReadCachePrewarmCategoryConfigProviders: readonly CachePrewarmProfitReadCategoryConfigProvider[] =
  [
    profitDashboardHomeCachePrewarmProvider,
    businessAnalysisCachePrewarmProvider,
    marketingOverviewCachePrewarmProvider,
    membersMetaCachePrewarmProvider,
    membersOverviewCachePrewarmProvider,
  ];
