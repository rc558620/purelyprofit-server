import { buildPulseSessionNotificationCacheKey } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseSessionNotificationCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseSessionNotification'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseSessionNotification: async (
    storeId: number,
  ): Promise<void> => {
    await input.redisService.del(
      buildPulseSessionNotificationCacheKey(storeId),
    );
  },
});
