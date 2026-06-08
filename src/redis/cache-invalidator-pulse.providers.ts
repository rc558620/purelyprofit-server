import { buildCacheInvalidatorRegistry } from './cache-invalidator.registry';
import { pulseDashboardHomeCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-home.provider';
import { pulseDashboardOverviewCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-overview.provider';
import { pulseDashboardRevenueDetailCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-revenue-detail.provider';
import { pulseGrowthAdminCacheInvalidatorProvider } from './cache-invalidator-pulse-growth-admin.provider';
import { pulseGrowthEarningsCacheInvalidatorProvider } from './cache-invalidator-pulse-growth-earnings.provider';
import { pulseOnboardingStatusCacheInvalidatorProvider } from './cache-invalidator-pulse-onboarding-status.provider';
import { pulseOnboardingStatusByUserCacheInvalidatorProvider } from './cache-invalidator-pulse-onboarding-status-user.provider';
import { pulseSessionBootstrapCacheInvalidatorProvider } from './cache-invalidator-pulse-session-bootstrap.provider';
import { pulseSessionBootstrapByUserCacheInvalidatorProvider } from './cache-invalidator-pulse-session-bootstrap-user.provider';
import { pulseSessionNotificationCacheInvalidatorProvider } from './cache-invalidator-pulse-session-notification.provider';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type { RedisService } from './redis.service';

export type PulseCacheInvalidatorInput = {
  redisService: Pick<RedisService, 'del' | 'delByPattern'>;
};

export type PulseCacheInvalidatorRegistry = {
  invalidatePulseDashboardHome: () => Promise<void>;
  invalidatePulseDashboardRevenueDetail: () => Promise<void>;
  invalidatePulseDashboardOverview: (storeId: number) => Promise<void>;
  invalidatePulseGrowthEarnings: (storeId: number) => Promise<void>;
  invalidatePulseGrowthAdminQueries: () => Promise<void>;
  invalidatePulseSessionNotification: (storeId: number) => Promise<void>;
  invalidatePulseSessionBootstrap: (storeId: number) => Promise<void>;
  invalidatePulseSessionBootstrapByUser: (userId: number) => Promise<void>;
  invalidatePulseOnboardingStatus: (storeId: number) => Promise<void>;
  invalidatePulseOnboardingStatusByUser: (userId: number) => Promise<void>;
};

const pulseCacheInvalidatorProviders: readonly CacheInvalidatorProvider<
  PulseCacheInvalidatorInput,
  Partial<PulseCacheInvalidatorRegistry>
>[] = [
  pulseDashboardHomeCacheInvalidatorProvider,
  pulseDashboardRevenueDetailCacheInvalidatorProvider,
  pulseDashboardOverviewCacheInvalidatorProvider,
  pulseGrowthEarningsCacheInvalidatorProvider,
  pulseGrowthAdminCacheInvalidatorProvider,
  pulseSessionNotificationCacheInvalidatorProvider,
  pulseSessionBootstrapCacheInvalidatorProvider,
  pulseSessionBootstrapByUserCacheInvalidatorProvider,
  pulseOnboardingStatusCacheInvalidatorProvider,
  pulseOnboardingStatusByUserCacheInvalidatorProvider,
];

export function createPulseCacheInvalidatorRegistry(
  input: PulseCacheInvalidatorInput,
): PulseCacheInvalidatorRegistry {
  return buildCacheInvalidatorRegistry<
    PulseCacheInvalidatorInput,
    PulseCacheInvalidatorRegistry
  >(pulseCacheInvalidatorProviders, input);
}
