import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import {
  PartnerReviewController,
  PlatformMembershipController,
  PromotionDetailCompatController,
} from './platform-membership.controller';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { PlatformMembershipService } from './platform-membership.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformMembershipController,
    PromotionDetailCompatController,
    PartnerReviewController,
  ],
  providers: [PlatformMembershipService, PlatformMembershipAccessService],
  exports: [PlatformMembershipService, PlatformMembershipAccessService],
})
export class PlatformMembershipModule {}
