import { buildPulseGrowthEarningsPattern } from '../purely-pulse/pulse.cache-keys';
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
    await input.redisService.delByPattern(
      buildPulseGrowthEarningsPattern(storeId),
    );
  },
});
