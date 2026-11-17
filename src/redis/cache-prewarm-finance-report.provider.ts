import {
  buildFinanceReportAllPattern,
  parseFinanceReportCacheKey,
} from './cache-keys';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import { FINANCE_REPORT_PREWARM_SELECTION } from './cache-prewarm-finance-policy';
import type {
  CachePrewarmFinanceCategoryConfigProvider,
  CachePrewarmFinanceConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';
import type { FinanceReportPeriodValue } from '../purely-profit/finance/finance.types';

/**
 * 财务报表缓存预热。
 *
 * 报表缓存按 `part` 拆成 summary / rows 两个 key（见 finance.cache-keys），
 * 因此预热必须按解析出的 part 定向重建——否则会把 summary 的值写进 rows 的 key，
 * 或者只刷一半让另一半一直靠请求回源。
 *
 * key 的解析统一走 `parseFinanceReportCacheKey`（唯一定义在 finance.cache-keys），
 * 这里不再维护第二份正则：key 结构变化时预热与失效不会各自漂移。
 */
export const financeReportCachePrewarmProvider: CachePrewarmFinanceCategoryConfigProvider =
  (input: CachePrewarmFinanceConfigInput) => ({
    category: 'financeReport',
    scanPattern: buildFinanceReportAllPattern,
    // 报表 key 含自定义区间，组合数无理论上限，必须按门店收敛
    resolveStoreId: (cacheKey) =>
      parseFinanceReportCacheKey(cacheKey)?.storeId ?? null,
    selection: FINANCE_REPORT_PREWARM_SELECTION,
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
            parsed.part,
          ),
        options,
      ),
  });
