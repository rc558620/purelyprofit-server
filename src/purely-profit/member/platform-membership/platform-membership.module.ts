import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import {
  PartnerReviewController,
  PlatformMembershipController,
  PromotionDetailCompatController,
} from './platform-membership.controller';
import { PlatformMembershipService } from './platform-membership.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformMembershipController,
    PromotionDetailCompatController,
    PartnerReviewController,
  ],
  providers: [PlatformMembershipService],
  exports: [PlatformMembershipService],
})
export class PlatformMembershipModule {}
