import {
  buildFinanceOverviewAllPattern,
  parseFinanceOverviewCacheKey,
} from '../purely-profit/finance/finance.cache-keys';
import type {
  CachePrewarmFinanceCategoryConfigProvider,
  CachePrewarmFinanceConfigInput,
} from './cache-prewarm.config.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import { FINANCE_OVERVIEW_PREWARM_SELECTION } from './cache-prewarm-finance-policy';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const financeOverviewCachePrewarmProvider: CachePrewarmFinanceCategoryConfigProvider =
  (input: CachePrewarmFinanceConfigInput) => ({
    category: 'financeOverview',
    scanPattern: buildFinanceOverviewAllPattern,
    // 概览 key 自带 store / period / scope，可直接按门店分组做配额收敛
    resolveStoreId: (cacheKey) =>
      parseFinanceOverviewCacheKey(cacheKey)?.storeId ?? null,
    selection: FINANCE_OVERVIEW_PREWARM_SELECTION,
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
