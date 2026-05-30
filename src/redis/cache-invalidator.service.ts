import { Injectable } from '@nestjs/common';
import {
  buildBusinessAnalysisPattern,
  buildFinanceOverviewPattern,
  buildMarketingOverviewCacheKey,
  buildProfitDashboardHomePattern,
  buildPulseDashboardHomePattern,
  buildPulseDashboardOverviewPattern,
  buildPulseSessionBootstrapPatternByStore,
  buildPulseSessionBootstrapPatternByUser,
  buildPulseSessionNotificationCacheKey,
} from './cache-keys';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidatorService {
  constructor(private readonly redisService: RedisService) {}

  async invalidateProfitDashboardHome(storeId: number): Promise<void> {
    await this.redisService.delByPattern(
      buildProfitDashboardHomePattern(storeId),
    );
  }

  async invalidateBusinessAnalysis(storeId: number): Promise<void> {
    await this.redisService.delByPattern(buildBusinessAnalysisPattern(storeId));
  }

  async invalidateFinanceOverview(storeId: number): Promise<void> {
    await this.redisService.delByPattern(buildFinanceOverviewPattern(storeId));
  }

  async invalidateMarketingOverview(storeId: number): Promise<void> {
    await this.redisService.del(buildMarketingOverviewCacheKey(storeId));
  }

  async invalidatePulseDashboardHome(): Promise<void> {
    await this.redisService.delByPattern(buildPulseDashboardHomePattern());
  }

  async invalidatePulseDashboardOverview(storeId: number): Promise<void> {
    await this.redisService.delByPattern(
      buildPulseDashboardOverviewPattern(storeId),
    );
  }

  async invalidatePulseSessionNotification(storeId: number): Promise<void> {
    await this.redisService.del(buildPulseSessionNotificationCacheKey(storeId));
  }

  async invalidatePulseSessionBootstrap(storeId: number): Promise<void> {
    await this.redisService.delByPattern(
      buildPulseSessionBootstrapPatternByStore(storeId),
    );
  }

  async invalidatePulseSessionBootstrapByUser(userId: number): Promise<void> {
    await this.redisService.delByPattern(
      buildPulseSessionBootstrapPatternByUser(userId),
    );
  }

  async invalidateDashboardAndPulseSession(storeId: number): Promise<void> {
    await Promise.all([
      this.invalidateProfitDashboardHome(storeId),
      this.invalidatePulseDashboardOverview(storeId),
      this.invalidatePulseSessionNotification(storeId),
      this.invalidatePulseSessionBootstrap(storeId),
    ]);
  }

  async invalidateFinanceDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.invalidateBusinessAnalysis(storeId),
      this.invalidateFinanceOverview(storeId),
    ]);
  }

  async invalidateSalesDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.invalidateProfitDashboardHome(storeId),
      this.invalidateBusinessAnalysis(storeId),
      this.invalidateFinanceOverview(storeId),
      this.invalidatePulseDashboardOverview(storeId),
      this.invalidatePulseSessionNotification(storeId),
      this.invalidatePulseSessionBootstrap(storeId),
    ]);
  }
}
