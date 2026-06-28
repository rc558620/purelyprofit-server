import { Global, Module } from '@nestjs/common';
import { BusinessAnalysisModule } from '../purely-profit/dashboard/business-analysis/business-analysis.module';
import { DashboardHomeModule } from '../purely-profit/dashboard/dashboard-home/dashboard-home.module';
import { ProfitDetailModule } from '../purely-profit/dashboard/profit-detail/profit-detail.module';
import { FinanceModule } from '../purely-profit/finance/finance.module';
import { MarketingModule } from '../purely-profit/marketing/marketing.module';
import { MembersModule } from '../purely-profit/member/members/members.module';
import { CostsModule } from '../purely-profit/operations/costs/costs.module';
import { CacheInvalidatorFinanceService } from './cache-invalidator-finance.service';
import { CacheInvalidatorMembershipService } from './cache-invalidator-membership.service';
import { CacheInvalidatorProfitReadService } from './cache-invalidator-profit-read.service';
import { CacheInvalidatorPulseService } from './cache-invalidator-pulse.service';
import { CacheInvalidatorService } from './cache-invalidator.service';
import { CachePrewarmCycleService } from './cache-prewarm-cycle.service';
import { CachePrewarmService } from './cache-prewarm.service';
import { RedisLockService } from './redis-lock.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    DashboardHomeModule,
    BusinessAnalysisModule,
    ProfitDetailModule,
    FinanceModule,
    MarketingModule,
    MembersModule,
    CostsModule,
  ],
  providers: [
    RedisService,
    RedisLockService,
    CacheInvalidatorFinanceService,
    CacheInvalidatorPulseService,
    CacheInvalidatorMembershipService,
    CacheInvalidatorProfitReadService,
    CacheInvalidatorService,
    CachePrewarmCycleService,
    CachePrewarmService,
  ],
  exports: [
    RedisService,
    RedisLockService,
    CacheInvalidatorFinanceService,
    CacheInvalidatorPulseService,
    CacheInvalidatorMembershipService,
    CacheInvalidatorProfitReadService,
    CacheInvalidatorService,
    CachePrewarmCycleService,
    CachePrewarmService,
  ],
})
export class RedisModule {}
