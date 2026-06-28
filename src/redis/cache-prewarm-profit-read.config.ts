import { businessAnalysisCachePrewarmProvider } from './cache-prewarm-business-analysis.provider';
import { costsReportCachePrewarmProvider } from './cache-prewarm-costs-report.provider';
import { costsStatsCachePrewarmProvider } from './cache-prewarm-costs-stats.provider';
import type { CachePrewarmProfitReadCategoryConfigProvider } from './cache-prewarm.config.types';
import { marketingOverviewCachePrewarmProvider } from './cache-prewarm-marketing-overview.provider';
import { membersMetaCachePrewarmProvider } from './cache-prewarm-members-meta.provider';
import { membersOverviewCachePrewarmProvider } from './cache-prewarm-members-overview.provider';
import { profitDetailCachePrewarmProvider } from './cache-prewarm-profit-detail.provider';
import { profitReportCachePrewarmProvider } from './cache-prewarm-profit-report.provider';
import { profitDashboardHomeCachePrewarmProvider } from './cache-prewarm-profit-dashboard-home.provider';

export const profitReadCachePrewarmCategoryConfigProviders: readonly CachePrewarmProfitReadCategoryConfigProvider[] =
  [
    profitDashboardHomeCachePrewarmProvider,
    businessAnalysisCachePrewarmProvider,
    marketingOverviewCachePrewarmProvider,
    membersMetaCachePrewarmProvider,
    membersOverviewCachePrewarmProvider,
    profitDetailCachePrewarmProvider,
    profitReportCachePrewarmProvider,
    costsStatsCachePrewarmProvider,
    costsReportCachePrewarmProvider,
  ];
