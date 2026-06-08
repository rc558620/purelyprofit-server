import { buildPulseOnboardingStatusPatternByStore } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseOnboardingStatusCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseOnboardingStatus'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseOnboardingStatus: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseOnboardingStatusPatternByStore(storeId),
    );
  },
});
