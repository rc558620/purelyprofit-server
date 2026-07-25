import {
  buildProfitDetailPattern,
  buildProfitReportPattern,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

export const profitDetailCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateProfitDetail'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateProfitDetail: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.delByPattern(buildProfitDetailPattern(storeId)),
      input.redisService.delByPattern(buildProfitReportPattern(storeId)),
    ]);
  },
});
