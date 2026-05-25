import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module';
import { StaffAccessService } from './staff-access.service';
import { StaffController } from './staff.controller';
import { StaffProfileService } from './staff-profile.service';
import { StaffService } from './staff.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffAccessService, StaffProfileService],
})
export class StaffModule {}
