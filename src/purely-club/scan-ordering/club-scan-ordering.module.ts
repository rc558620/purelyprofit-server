import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { CommerceModule } from '../../purely-profit/commerce/commerce.module';
import { PlatformMembershipAccessModule } from '../../purely-profit/member/platform-membership/platform-membership-access.module';
// 新客额度：本店新客在额度耗尽时需阻止下单，依赖该模块提供的预检与扣减
import { NewCustomerQuotaModule } from '../../purely-profit/member/new-customer-quota/new-customer-quota.module';
import { SalesRecordModule } from '../../purely-profit/operations/sales-record/sales-record.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubPaymentModeModule } from '../payments/club-payment-mode.module';
import { ClubServiceCallModule } from '../service-call/club-service-call.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubScanOrderingController } from './club-scan-ordering.controller';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import { ClubScanOrderingService } from './club-scan-ordering.service';
import { ClubScanOrderingQrTokenService } from './club-scan-ordering-qr-token.service';
import { ClubScanOrderingSessionService } from './club-scan-ordering-session.service';
import { ClubScanOrderingCartService } from './club-scan-ordering-cart.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingServiceCallService } from './club-scan-ordering-service-call.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ClubScanOrderingWechatVerifyService } from './club-scan-ordering-wechat-verify.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingPaymentService } from './club-scan-ordering-payment.service';
// 支付落账锁仅依赖 RedisService，本地提供实例，避免引入整个 ClubPaymentsModule 造成循环依赖
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ScanOrderingGateway } from './scan-ordering.gateway';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPaymentExpirationService } from './scan-ordering-payment-expiration.service';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';
import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import { ScanOrderingSaleOrderBridgeService } from './scan-ordering-sale-order-bridge.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ScanOrderingPickupSettingsService } from './scan-ordering-pickup-settings.service';
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';

@Module({
  imports: [
    AuthModule,
    CommerceModule,
    // 会员过期门店需在 C 端拦截新下单，依赖该模块提供的 MembershipDowngradeService
    PlatformMembershipAccessModule,
    NewCustomerQuotaModule,
    SalesRecordModule,
    PrismaModule,
    RedisModule,
    ClubWechatPayModule,
    // 扫码点餐开发态确认支付的闸门由支付模式服务裁决
    ClubPaymentModeModule,
    ClubServiceCallModule,
    ClubOrdersModule,
    ClubStoresModule,
  ],
  controllers: [ClubScanOrderingController],
  providers: [
    ClubNewCustomerQuotaService,
    ClubScanOrderingService,
    ClubScanOrderingQrTokenService,
    ClubScanOrderingSessionService,
    ClubScanOrderingCartService,
    ClubScanOrderingMenuQueryService,
    ClubScanOrderingServiceCallService,
    ClubScanOrderingOrderService,
    ClubScanOrderingOrderQueryService,
    ClubScanOrderingWechatVerifyService,
    ClubScanOrderingOrderHistoryService,
    ClubScanOrderingOrderPreviewService,
    ClubScanOrderingCartPricingService,
    ClubScanOrderingCheckoutService,
    // 支付回调落账与微信侧主动核对共用同一落账入口，provider 归属扫码点餐模块
    ClubScanOrderingPaymentService,
    ClubPaymentLockService,
    ClubScanOrderingInventoryReservationService,
    ClubScanOrderingMarketingCustomerService,
    ScanOrderingSaleOrderBridgeService,
    ScanOrderingRealtimeService,
    ScanOrderingUnpaidOrderClosureService,
    ScanOrderingPaymentExpirationService,
    ScanOrderingRefundService,
    ScanOrderingPromotionAdapter,
    ScanOrderingPricingVersionService,
    ScanOrderingPickupNumberService,
    ScanOrderingPickupSettingsService,
    ScanOrderingGateway,
  ],
  exports: [
    ClubScanOrderingService,
    // 支付回调分发（ClubPaymentsModule）通过导入本模块消费同一实例
    ClubScanOrderingPaymentService,
    ClubScanOrderingOrderService,
    ClubScanOrderingMarketingCustomerService,
    ScanOrderingRealtimeService,
    ScanOrderingRefundService,
    ScanOrderingUnpaidOrderClosureService,
    ScanOrderingSaleOrderBridgeService,
    ScanOrderingPromotionAdapter,
    ScanOrderingPricingVersionService,
    ScanOrderingPickupNumberService,
    ScanOrderingPickupSettingsService,
  ],
})
export class ClubScanOrderingModule {}
