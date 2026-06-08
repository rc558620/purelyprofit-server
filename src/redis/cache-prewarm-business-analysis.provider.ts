import {
  buildBusinessAnalysisAllPattern,
  parseBusinessAnalysisCacheKey,
} from './cache-keys';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const businessAnalysisCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'businessAnalysis',
    scanPattern: buildBusinessAnalysisAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'businessAnalysis',
        cacheKeys,
        parseBusinessAnalysisCacheKey,
        (parsed) =>
          input.businessAnalysisService.warmAnalysisCache(parsed.storeId, {
            period: parsed.period,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
          }),
        options,
      ),
  });
