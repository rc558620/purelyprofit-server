import { buildPulseGrowthAdminPattern } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseGrowthAdminCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseGrowthAdminQueries'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseGrowthAdminQueries: async (): Promise<void> => {
    await input.redisService.delByPattern(buildPulseGrowthAdminPattern());
  },
});
