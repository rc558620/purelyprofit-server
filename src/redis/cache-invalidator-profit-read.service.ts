import { Injectable } from '@nestjs/common';
import {
  createProfitReadCacheInvalidatorRegistry,
  type ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidatorProfitReadService {
  private readonly registry: ProfitReadCacheInvalidatorRegistry;

  constructor(private readonly redisService: RedisService) {
    this.registry = createProfitReadCacheInvalidatorRegistry({
      redisService: this.redisService,
    });
  }

  async invalidateProfitDashboardHome(storeId: number): Promise<void> {
    await this.registry.invalidateProfitDashboardHome(storeId);
  }

  async invalidateBusinessAnalysis(storeId: number): Promise<void> {
    await this.registry.invalidateBusinessAnalysis(storeId);
  }

  async invalidateMarketingOverview(storeId: number): Promise<void> {
    await this.registry.invalidateMarketingOverview(storeId);
  }

  async invalidateSalesReadCaches(storeId: number): Promise<void> {
    await this.registry.invalidateSalesReadCaches(storeId);
  }
}
