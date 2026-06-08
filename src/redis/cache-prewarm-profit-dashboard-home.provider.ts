import {
  buildProfitDashboardHomeAllPattern,
  parseProfitDashboardHomeCacheKey,
} from './cache-keys';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const profitDashboardHomeCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
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
  });
