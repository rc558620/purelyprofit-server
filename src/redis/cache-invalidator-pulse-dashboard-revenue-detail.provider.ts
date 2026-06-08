import { buildPulseDashboardRevenueDetailPattern } from '../purely-pulse/pulse.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  PulseCacheInvalidatorInput,
  PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';

export const pulseDashboardRevenueDetailCacheInvalidatorProvider: CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Pick<PulseCacheInvalidatorRegistry, 'invalidatePulseDashboardRevenueDetail'>
> = (input: PulseCacheInvalidatorInput) => ({
  invalidatePulseDashboardRevenueDetail: async (): Promise<void> => {
    await input.redisService.delByPattern(
      buildPulseDashboardRevenueDetailPattern(),
    );
  },
});
