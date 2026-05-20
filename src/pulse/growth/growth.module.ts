import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { WithdrawalsModule } from '../../member/withdrawals/withdrawals.module';
import { PulseGrowthController } from './growth.controller';
import { PulseGrowthService } from './growth.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule, WithdrawalsModule],
  controllers: [PulseGrowthController],
  providers: [PulseGrowthService],
})
export class PulseGrowthModule {}
