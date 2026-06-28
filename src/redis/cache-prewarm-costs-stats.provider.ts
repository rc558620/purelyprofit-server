import {
  buildCostsAllPattern,
  buildCostsStatsCacheKey,
} from './cache-keys';
import type { CostPeriodValue, CostTypeFilterValue } from '../purely-profit/operations/costs/costs.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

function parseCostsStatsCacheKey(cacheKey: string): {
  storeId: number;
  period?: string;
  typeFilter?: string;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
} | null {
  const match =
    /^profit:costs:stats:store:(\d+):period:([^:]+):typeFilter:([^:]+):customDate:([^:]+):rangeStart:([^:]+):rangeEnd:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod, rawTypeFilter, rawCustomDate, rawRangeStart, rawRangeEnd] = match;

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod === 'na' ? undefined : rawPeriod,
    typeFilter: rawTypeFilter === 'na' ? undefined : rawTypeFilter,
    customDate: rawCustomDate === 'na' ? undefined : Number(rawCustomDate),
    rangeStartDate: rawRangeStart === 'na' ? undefined : Number(rawRangeStart),
    rangeEndDate: rawRangeEnd === 'na' ? undefined : Number(rawRangeEnd),
  };
}

export const costsStatsCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'costsStats',
    scanPattern: buildCostsAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'costsStats',
        cacheKeys,
        parseCostsStatsCacheKey,
        (parsed) =>
          input.costsReadService.warmStatsCache(parsed.storeId, {
            period: parsed.period as CostPeriodValue | undefined,
            typeFilter: parsed.typeFilter as CostTypeFilterValue | undefined,
            customDate: parsed.customDate,
            rangeStartDate: parsed.rangeStartDate,
            rangeEndDate: parsed.rangeEndDate,
          }),
        options,
      ),
  });
