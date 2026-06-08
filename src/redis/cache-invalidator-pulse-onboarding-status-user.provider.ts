import { buildPulseOnboardingStatusPatternByUser } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseOnboardingStatusByUserCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseOnboardingStatusByUser'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseOnboardingStatusByUser: async (
    userId: number,
  ): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseOnboardingStatusPatternByUser(userId),
    );
  },
});
