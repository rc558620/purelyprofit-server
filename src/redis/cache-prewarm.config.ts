import type { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import type { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import type { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import {
  buildBusinessAnalysisAllPattern,
  buildFinanceOverviewAllPattern,
  buildProfitDashboardHomeAllPattern,
  parseBusinessAnalysisCacheKey,
  parseFinanceOverviewCacheKey,
  parseProfitDashboardHomeCacheKey,
} from './cache-keys';
import type {
  CachePrewarmCategoryConfig,
  CachePrewarmExecutionOptions,
} from './cache-prewarm.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';

export function createCachePrewarmCategoryConfigs(input: {
  dashboardHomeService: Pick<DashboardHomeService, 'warmOverviewCache'>;
  businessAnalysisService: Pick<BusinessAnalysisService, 'warmAnalysisCache'>;
  financeOverviewService: Pick<FinanceOverviewService, 'warmOverviewCache'>;
}): readonly CachePrewarmCategoryConfig[] {
  return [
    {
      category: 'dashboardHome',
      scanPattern: buildProfitDashboardHomeAllPattern,
      prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
        prewarmCacheCategory(
          'dashboardHome',
          cacheKeys,
          parseProfitDashboardHomeCacheKey,
          (parsed) =>
            input.dashboardHomeService.warmOverviewCache(
              parsed.storeId,
              parsed.period,
            ),
          options,
        ),
    },
    {
      category: 'businessAnalysis',
      scanPattern: buildBusinessAnalysisAllPattern,
      prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
        prewarmCacheCategory(
          'businessAnalysis',
          cacheKeys,
          parseBusinessAnalysisCacheKey,
          (parsed) =>
            input.businessAnalysisService.warmAnalysisCache(parsed.storeId, {
              period: parsed.period,
              startTime: parsed.startTime,
              endTime: parsed.endTime,
            }),
          options,
        ),
    },
    {
      category: 'financeOverview',
      scanPattern: buildFinanceOverviewAllPattern,
      prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
        prewarmCacheCategory(
          'financeOverview',
          cacheKeys,
          parseFinanceOverviewCacheKey,
          (parsed) =>
            input.financeOverviewService.warmOverviewCache(
              parsed.storeId,
              parsed.period,
            ),
          options,
        ),
    },
  ];
}
