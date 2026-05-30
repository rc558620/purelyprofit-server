import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import {
  PartnerReviewController,
  PlatformMembershipController,
  PromotionDetailCompatController,
} from './platform-membership.controller';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { PlatformMembershipLedgerService } from './platform-membership-ledger.service';
import { PlatformMembershipOrderService } from './platform-membership-order.service';
import { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import { PlatformMembershipService } from './platform-membership.service';
import { StoreSubAccountService } from './store-sub-account.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformMembershipController,
    PromotionDetailCompatController,
    PartnerReviewController,
  ],
  providers: [
    PlatformMembershipService,
    PlatformMembershipReadService,
    PlatformMembershipLedgerService,
    PlatformMembershipPartnerService,
    PlatformMembershipOrderService,
    PlatformMembershipAccessService,
    StoreSubAccountService,
  ],
  exports: [
    PlatformMembershipService,
    PlatformMembershipAccessService,
    StoreSubAccountService,
  ],
})
export class PlatformMembershipModule {}
