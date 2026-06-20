import { buildPulseGrowthEarningsPatterns } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseGrowthEarningsCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseGrowthEarnings'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseGrowthEarnings: async (storeId: number): Promise<void> => {
    const patterns = buildPulseGrowthEarningsPatterns(storeId);
    await Promise.all(
      patterns.map((pattern) => input.redisService.delByPattern(pattern)),
    );
  },
});
