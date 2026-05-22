import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PlatformMembershipModule } from '../../purely-profit/member/platform-membership/platform-membership.module';
import { WithdrawalsModule } from '../../purely-profit/member/withdrawals/withdrawals.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { PulseGrowthController } from './growth.controller';
import { PulseGrowthService } from './growth.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule, WithdrawalsModule, PulseStoreContextModule],
  controllers: [PulseGrowthController],
  providers: [PulseGrowthService],
})
export class PulseGrowthModule {}
