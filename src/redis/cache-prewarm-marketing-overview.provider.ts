import {
  buildMarketingOverviewAllPattern,
  parseMarketingOverviewCacheKey,
} from './cache-keys';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const marketingOverviewCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'marketingOverview',
    scanPattern: buildMarketingOverviewAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'marketingOverview',
        cacheKeys,
        parseMarketingOverviewCacheKey,
        (parsed) => input.marketingOverviewService.warmOverviewCache(parsed.storeId),
        options,
      ),
  });
