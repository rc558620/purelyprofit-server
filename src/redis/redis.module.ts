import { Global, Module } from '@nestjs/common';
import { BusinessAnalysisModule } from '../purely-profit/dashboard/business-analysis/business-analysis.module';
import { DashboardHomeModule } from '../purely-profit/dashboard/dashboard-home/dashboard-home.module';
import { FinanceModule } from '../purely-profit/finance/finance.module';
import { CacheInvalidatorService } from './cache-invalidator.service';
import { CachePrewarmService } from './cache-prewarm.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [DashboardHomeModule, BusinessAnalysisModule, FinanceModule],
  providers: [RedisService, CacheInvalidatorService, CachePrewarmService],
  exports: [RedisService, CacheInvalidatorService, CachePrewarmService],
})
export class RedisModule {}
