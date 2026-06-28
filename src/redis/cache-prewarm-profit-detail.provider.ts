import {
  buildProfitDetailAllPattern,
  parseProfitDetailCacheKey,
} from './cache-keys';
import type { ProfitDetailPeriodValue } from '../purely-profit/dashboard/profit-detail/profit-detail.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const profitDetailCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'profitDetail',
    scanPattern: buildProfitDetailAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'profitDetail',
        cacheKeys,
        parseProfitDetailCacheKey,
        (parsed) =>
          input.profitDetailService.warmDetailCache(parsed.storeId, {
            period: parsed.period as ProfitDetailPeriodValue | undefined,
            year: parsed.year,
            customDate: parsed.customDate,
            rangeStartDate: parsed.rangeStartDate,
            rangeEndDate: parsed.rangeEndDate,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
          }),
        options,
      ),
  });
