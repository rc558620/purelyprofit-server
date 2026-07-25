import { buildCostsAllPattern } from './cache-keys';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';
import type {
  CostReportPeriodValue,
  CostReportCategoryFilterValue,
} from '../purely-profit/operations/costs/costs.types';

function parseCostsReportCacheKey(cacheKey: string): {
  storeId: number;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  categoryFilter?: string;
} | null {
  const match =
    /^profit:costs:report:store:(\d+):period:([^:]+):year:([^:]+):customDate:([^:]+):rangeStart:([^:]+):rangeEnd:([^:]+):category:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [
    ,
    rawStoreId,
    rawPeriod,
    rawYear,
    rawCustomDate,
    rawRangeStart,
    rawRangeEnd,
    rawCategory,
  ] = match;

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod === 'na' ? undefined : rawPeriod,
    year: rawYear === 'na' ? undefined : Number(rawYear),
    customDate: rawCustomDate === 'na' ? undefined : Number(rawCustomDate),
    rangeStartDate: rawRangeStart === 'na' ? undefined : Number(rawRangeStart),
    rangeEndDate: rawRangeEnd === 'na' ? undefined : Number(rawRangeEnd),
    categoryFilter: rawCategory === 'na' ? undefined : rawCategory,
  };
}

export const costsReportCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'costsReport',
    scanPattern: buildCostsAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'costsReport',
        cacheKeys,
        parseCostsReportCacheKey,
        (parsed) =>
          input.costsReadService.warmReportCache(parsed.storeId, {
            period: parsed.period as CostReportPeriodValue | undefined,
            year: parsed.year,
            customDate: parsed.customDate,
            rangeStartDate: parsed.rangeStartDate,
            rangeEndDate: parsed.rangeEndDate,
            categoryFilter: parsed.categoryFilter as
              | CostReportCategoryFilterValue
              | undefined,
          }),
        options,
      ),
  });
