import {
  buildProfitReportAllPattern,
  parseProfitReportCacheKey,
} from './cache-keys';
import type { ProfitDetailPeriodValue } from '../purely-profit/dashboard/profit-detail/profit-detail.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const profitReportCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'profitReport',
    scanPattern: buildProfitReportAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'profitReport',
        cacheKeys,
        parseProfitReportCacheKey,
        (parsed) =>
          input.profitDetailService.warmReportCache(parsed.storeId, {
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
