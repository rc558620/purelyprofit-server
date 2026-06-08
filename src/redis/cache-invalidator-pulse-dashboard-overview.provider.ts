import { buildPulseDashboardOverviewPattern } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseDashboardOverviewCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseDashboardOverview'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseDashboardOverview: async (storeId: number): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseDashboardOverviewPattern(storeId),
    );
  },
});
