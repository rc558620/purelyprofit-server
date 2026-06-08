import { buildBusinessAnalysisPattern } from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const businessAnalysisCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateBusinessAnalysis'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateBusinessAnalysis: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(
      buildBusinessAnalysisPattern(storeId),
    );
  },
});
