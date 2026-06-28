import { buildFinanceReportAllPattern } from './cache-keys';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmFinanceCategoryConfigProvider,
  CachePrewarmFinanceConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';
import type { FinanceReportPeriodValue } from '../purely-profit/finance/finance.types';

function parseFinanceReportCacheKey(cacheKey: string): {
  storeId: number;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  scope?: 'owner' | 'sub_account';
} | null {
  const match =
    /^profit:finance:report:store:(\d+):scope:(owner|sub_account):period:([^:]+):year:([^:]+):customDate:([^:]+):rangeStart:([^:]+):rangeEnd:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawScope, rawPeriod, rawYear, rawCustomDate, rawRangeStart, rawRangeEnd] = match;

  return {
    storeId: Number(rawStoreId),
    scope: rawScope as 'owner' | 'sub_account',
    period: rawPeriod === 'na' ? undefined : rawPeriod,
    year: rawYear === 'na' ? undefined : Number(rawYear),
    customDate: rawCustomDate === 'na' ? undefined : Number(rawCustomDate),
    rangeStartDate: rawRangeStart === 'na' ? undefined : Number(rawRangeStart),
    rangeEndDate: rawRangeEnd === 'na' ? undefined : Number(rawRangeEnd),
  };
}

export const financeReportCachePrewarmProvider: CachePrewarmFinanceCategoryConfigProvider =
  (input: CachePrewarmFinanceConfigInput) => ({
    category: 'financeReport',
    scanPattern: buildFinanceReportAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'financeReport',
        cacheKeys,
        parseFinanceReportCacheKey,
        (parsed) =>
          input.financeOverviewService.warmReportCache(
            parsed.storeId,
            {
              period: parsed.period as FinanceReportPeriodValue | undefined,
              year: parsed.year,
              customDate: parsed.customDate,
              rangeStartDate: parsed.rangeStartDate,
              rangeEndDate: parsed.rangeEndDate,
            },
            parsed.scope,
          ),
        options,
      ),
  });
