import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProfitPaymentsModule } from '../../payments/profit-payments.module';
import { NewCustomerQuotaModule } from '../new-customer-quota/new-customer-quota.module';
import { PlatformMembershipAccessModule } from './platform-membership-access.module';
import { PlatformMembershipActivationService } from './platform-membership-activation.service';
import { PlatformMembershipPaymentService } from './platform-membership-payment.service';
import { PartnerReviewController } from './partner-review.controller';
import { PlatformMembershipController } from './platform-membership.controller';
import { PromotionDetailCompatController } from './promotion-detail-compat.controller';
import { MembershipRenewalService } from './membership-renewal.service';
import { PlatformMembershipLedgerService } from './platform-membership-ledger.service';
import { PlatformMembershipOrderService } from './platform-membership-order.service';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';
import { PlatformMembershipPartnerService } from './platform-membership-partner.service';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import { PlatformMembershipService } from './platform-membership.service';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { StoreSubAccountLoginService } from './store-sub-account-login.service';
import { StoreSubAccountConflictCheckService } from './store-sub-account-conflict-check.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import { StoreSubAccountService } from './store-sub-account.service';
import { StoreSubAccountSlotService } from './store-sub-account-slot.service';

@Module({
  // ProfitPaymentsModule 提供支付单与平台 Native 下单能力（不反向依赖业务模块）
  imports: [
    AuthModule,
    PlatformMembershipAccessModule,
    NewCustomerQuotaModule,
    ProfitPaymentsModule,
  ],
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
    PlatformMembershipActivationService,
    PlatformMembershipPaymentService,
    PlatformMembershipPromoService,
    PlatformMembershipPromoBeanReconciliationService,
    MembershipRenewalService,
    StoreMembershipLockedPriceService,
    StoreSubAccountLoginService,
    StoreSubAccountConflictCheckService,
    StoreSubAccountReadService,
    StoreSubAccountSlotService,
    StoreSubAccountService,
  ],
  exports: [
    PlatformMembershipService,
    // 支付回调分发需要按支付单号反查并生效会员订单
    PlatformMembershipPaymentService,
    MembershipRenewalService,
    StoreMembershipLockedPriceService,
    // 导出整个轻量模块，使其中的 MembershipDowngradeService 对
    // 已导入本模块的下游（销售记录 / 空间 / C 端）可见
    PlatformMembershipAccessModule,
    StoreSubAccountService,
    StoreSubAccountLoginService,
  ],
})
export class PlatformMembershipModule {}
