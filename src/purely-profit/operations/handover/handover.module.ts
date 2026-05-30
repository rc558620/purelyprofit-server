import { Module } from '@nestjs/common';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  imports: [PlatformMembershipModule],
  controllers: [HandoverController],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class HandoverModule {}
