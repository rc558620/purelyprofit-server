import type { CachePrewarmFinanceCategoryConfigProvider } from './cache-prewarm.config.types';
import { financeOverviewCachePrewarmProvider } from './cache-prewarm-finance-overview.provider';
import { financeReportCachePrewarmProvider } from './cache-prewarm-finance-report.provider';

export const financeCachePrewarmCategoryConfigProviders: readonly CachePrewarmFinanceCategoryConfigProvider[] =
  [financeOverviewCachePrewarmProvider, financeReportCachePrewarmProvider];
