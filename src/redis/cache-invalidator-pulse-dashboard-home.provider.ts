import { buildPulseDashboardHomePattern } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseDashboardHomeCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseDashboardHome'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseDashboardHome: async (): Promise<void> => {
    await input.redisService.delByPattern(buildPulseDashboardHomePattern());
  },
});
