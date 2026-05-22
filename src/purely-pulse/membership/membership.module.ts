import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PlatformMembershipModule } from '../../purely-profit/member/platform-membership/platform-membership.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { PulseMembershipController } from './membership.controller';
import { PulseMembershipService } from './membership.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule, PulseStoreContextModule],
  controllers: [PulseMembershipController],
  providers: [PulseMembershipService],
})
export class PulseMembershipModule {}
