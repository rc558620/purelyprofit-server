import { Injectable } from '@nestjs/common';
import {
  createPulseCacheInvalidatorRegistry,
  type PulseCacheInvalidatorRegistry,
} from './cache-invalidator-pulse.providers';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidatorPulseService {
  private readonly registry: PulseCacheInvalidatorRegistry;

  constructor(private readonly redisService: RedisService) {
    this.registry = createPulseCacheInvalidatorRegistry({
      redisService: this.redisService,
    });
  }

  async invalidatePulseDashboardHome(): Promise<void> {
    await this.registry.invalidatePulseDashboardHome();
  }

  async invalidatePulseDashboardRevenueDetail(): Promise<void> {
    await this.registry.invalidatePulseDashboardRevenueDetail();
  }

  async invalidatePulseDashboardOverview(storeId: number): Promise<void> {
    await this.registry.invalidatePulseDashboardOverview(storeId);
  }

  async invalidatePulseGrowthEarnings(storeId: number): Promise<void> {
    await this.registry.invalidatePulseGrowthEarnings(storeId);
  }

  async invalidatePulseGrowthAdminQueries(): Promise<void> {
    await this.registry.invalidatePulseGrowthAdminQueries();
  }

  async invalidatePulseSessionNotification(storeId: number): Promise<void> {
    await this.registry.invalidatePulseSessionNotification(storeId);
  }

  async invalidatePulseSessionBootstrap(storeId: number): Promise<void> {
    await this.registry.invalidatePulseSessionBootstrap(storeId);
  }

  async invalidatePulseSessionBootstrapByUser(userId: number): Promise<void> {
    await this.registry.invalidatePulseSessionBootstrapByUser(userId);
  }

  async invalidatePulseOnboardingStatus(storeId: number): Promise<void> {
    await this.registry.invalidatePulseOnboardingStatus(storeId);
  }

  async invalidatePulseOnboardingStatusByUser(userId: number): Promise<void> {
    await this.registry.invalidatePulseOnboardingStatusByUser(userId);
  }

  async invalidateDashboardAndPulseSession(storeId: number): Promise<void> {
    await Promise.all([
      this.registry.invalidatePulseDashboardOverview(storeId),
      this.registry.invalidatePulseSessionNotification(storeId),
      this.registry.invalidatePulseSessionBootstrap(storeId),
      this.registry.invalidatePulseOnboardingStatus(storeId),
    ]);
  }
}
