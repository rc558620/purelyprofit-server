import { buildPulseSessionBootstrapPatternByStore } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseSessionBootstrapCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseSessionBootstrap'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseSessionBootstrap: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseSessionBootstrapPatternByStore(storeId),
    );
  },
});
