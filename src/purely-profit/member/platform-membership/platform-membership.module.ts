import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipAccessModule } from './platform-membership-access.module';
import { PartnerReviewController } from './partner-review.controller';
import { PlatformMembershipController } from './platform-membership.controller';
import { PromotionDetailCompatController } from './promotion-detail-compat.controller';
import { PlatformMembershipLedgerService } from './platform-membership-ledger.service';
import { PlatformMembershipOrderService } from './platform-membership-order.service';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';
import { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import { PlatformMembershipService } from './platform-membership.service';
import { StoreSubAccountLoginService } from './store-sub-account-login.service';
import { StoreSubAccountConflictCheckService } from './store-sub-account-conflict-check.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import { StoreSubAccountService } from './store-sub-account.service';
import { StoreSubAccountSlotService } from './store-sub-account-slot.service';

@Module({
  imports: [AuthModule, PlatformMembershipAccessModule],
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
    PlatformMembershipPromoService,
    PlatformMembershipPromoBeanReconciliationService,
    StoreSubAccountLoginService,
    StoreSubAccountConflictCheckService,
    StoreSubAccountReadService,
    StoreSubAccountSlotService,
    StoreSubAccountService,
  ],
  exports: [
    PlatformMembershipService,
    PlatformMembershipAccessModule,
    StoreSubAccountService,
    StoreSubAccountLoginService,
  ],
})
export class PlatformMembershipModule {}
