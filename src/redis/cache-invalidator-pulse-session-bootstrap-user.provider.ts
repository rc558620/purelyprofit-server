import { buildPulseSessionBootstrapPatternByUser } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseSessionBootstrapByUserCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseSessionBootstrapByUser'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseSessionBootstrapByUser: async (
    userId: number,
  ): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseSessionBootstrapPatternByUser(userId),
    );
  },
});
