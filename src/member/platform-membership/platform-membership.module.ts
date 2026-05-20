import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipController } from './platform-membership.controller';
import { PlatformMembershipService } from './platform-membership.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformMembershipController],
  providers: [PlatformMembershipService],
  exports: [PlatformMembershipService],
})
export class PlatformMembershipModule {}
