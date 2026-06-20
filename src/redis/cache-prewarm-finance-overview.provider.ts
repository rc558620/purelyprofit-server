import {
  buildFinanceOverviewAllPattern,
  parseFinanceOverviewCacheKey,
} from '../purely-profit/finance/finance.cache-keys';
import type {
  CachePrewarmFinanceCategoryConfigProvider,
  CachePrewarmFinanceConfigInput,
} from './cache-prewarm.config.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const financeOverviewCachePrewarmProvider: CachePrewarmFinanceCategoryConfigProvider =
  (input: CachePrewarmFinanceConfigInput) => ({
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
            parsed.scope,
          ),
        options,
      ),
  });
