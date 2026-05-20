import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PulseMembershipController } from './membership.controller';
import { PulseMembershipService } from './membership.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule],
  controllers: [PulseMembershipController],
  providers: [PulseMembershipService],
})
export class PulseMembershipModule {}
