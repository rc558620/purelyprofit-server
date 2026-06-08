import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { RedisModule } from '../../redis/redis.module';
import { PlatformMembershipModule } from '../../purely-profit/member/platform-membership/platform-membership.module';
import { WithdrawalsModule } from '../../purely-profit/member/withdrawals/withdrawals.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { PulseGrowthAccessService } from './growth-access.service';
import { PulseGrowthAdminPartnerApplicationService } from './growth-admin-partner-application.service';
import { PulseGrowthAdminPayoutService } from './growth-admin-payout.service';
import { PulseGrowthAdminQueryService } from './growth-admin-query.service';
import { PulseGrowthAdminController } from './growth-admin.controller';
import { PulseGrowthAdminService } from './growth-admin.service';
import { PulseGrowthController } from './growth.controller';
import { PulseGrowthEarningsController } from './growth-earnings.controller';
import { PulseGrowthEarningsService } from './growth-earnings.service';
import { PulseGrowthService } from './growth.service';
import { PulseGrowthWithdrawalsController } from './growth-withdrawals.controller';

@Module({
  imports: [
    AuthModule,
    PlatformMembershipModule,
    WithdrawalsModule,
    PulseStoreContextModule,
    RedisModule,
  ],
  controllers: [
    PulseGrowthController,
    PulseGrowthAdminController,
    PulseGrowthEarningsController,
    PulseGrowthWithdrawalsController,
  ],
  providers: [
    PulseGrowthService,
    PulseGrowthAccessService,
    PulseGrowthAdminService,
    PulseGrowthAdminQueryService,
    PulseGrowthAdminPartnerApplicationService,
    PulseGrowthAdminPayoutService,
    PulseGrowthEarningsService,
  ],
})
export class PulseGrowthModule {}
