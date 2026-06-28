import { Injectable } from '@nestjs/common';
import {
  createFinanceCacheInvalidatorRegistry,
  type FinanceCacheInvalidatorRegistry,
} from './cache-invalidator-finance.providers';
import { RedisService } from './redis.service';

@Injectable()
export class CacheInvalidatorFinanceService {
  private readonly registry: FinanceCacheInvalidatorRegistry;

  constructor(private readonly redisService: RedisService) {
    this.registry = createFinanceCacheInvalidatorRegistry({
      redisService: this.redisService,
    });
  }

  async invalidateFinanceOverview(storeId: number): Promise<void> {
    await this.registry.invalidateFinanceOverview(storeId);
  }

  async invalidateFinanceCashFlow(storeId: number): Promise<void> {
    await this.registry.invalidateFinanceCashFlow(storeId);
  }

  async invalidateFinanceAccounts(storeId: number): Promise<void> {
    await this.registry.invalidateFinanceAccounts(storeId);
  }

  async invalidateFinanceReconciliations(storeId: number): Promise<void> {
    await this.registry.invalidateFinanceReconciliations(storeId);
  }

  async invalidateFinanceReport(storeId: number): Promise<void> {
    await this.registry.invalidateFinanceReport(storeId);
  }
}
