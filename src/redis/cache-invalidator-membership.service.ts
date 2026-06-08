import { Injectable } from '@nestjs/common';
import {
  createMembershipCacheInvalidatorRegistry,
  type MembershipCacheInvalidatorRegistry,
} from './cache-invalidator-membership.providers';
import { CacheInvalidatorPulseService } from './cache-invalidator-pulse.service';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidatorMembershipService {
  private readonly registry: MembershipCacheInvalidatorRegistry;

  constructor(
    private readonly redisService: RedisService,
    private readonly pulseInvalidator: CacheInvalidatorPulseService,
  ) {
    this.registry = createMembershipCacheInvalidatorRegistry({
      redisService: this.redisService,
    });
  }

  async invalidateMembersDerived(storeId: number): Promise<void> {
    await this.registry.invalidateMembersDerived(storeId);
  }

  async invalidateWithdrawalsDerived(storeId: number): Promise<void> {
    await this.registry.invalidateWithdrawalsDerived(storeId);
  }

  async invalidatePlatformMembershipDerived(storeId: number): Promise<void> {
    await this.registry.invalidatePlatformMembershipDerived(storeId);
  }

  async invalidateMembershipDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.registry.invalidatePlatformMembershipDerived(storeId),
      this.registry.invalidateWithdrawalsDerived(storeId),
      this.pulseInvalidator.invalidatePulseDashboardHome(),
      this.pulseInvalidator.invalidatePulseDashboardRevenueDetail(),
      this.pulseInvalidator.invalidatePulseGrowthEarnings(storeId),
      this.pulseInvalidator.invalidatePulseGrowthAdminQueries(),
      this.pulseInvalidator.invalidatePulseSessionNotification(storeId),
      this.pulseInvalidator.invalidatePulseSessionBootstrap(storeId),
      this.pulseInvalidator.invalidatePulseOnboardingStatus(storeId),
    ]);
  }
}
