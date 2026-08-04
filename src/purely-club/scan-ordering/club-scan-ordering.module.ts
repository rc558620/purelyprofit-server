import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { CommerceModule } from '../../purely-profit/commerce/commerce.module';
import { SalesRecordModule } from '../../purely-profit/operations/sales-record/sales-record.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubServiceCallModule } from '../service-call/club-service-call.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubScanOrderingController } from './club-scan-ordering.controller';
import { ClubScanOrderingService } from './club-scan-ordering.service';
import { ClubScanOrderingCartService } from './club-scan-ordering-cart.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingServiceCallService } from './club-scan-ordering-service-call.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ScanOrderingGateway } from './scan-ordering.gateway';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPaymentExpirationService } from './scan-ordering-payment-expiration.service';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';
import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import { ScanOrderingSaleOrderBridgeService } from './scan-ordering-sale-order-bridge.service';

@Module({
  imports: [
    AuthModule,
    CommerceModule,
    SalesRecordModule,
    PrismaModule,
    RedisModule,
    ClubWechatPayModule,
    ClubServiceCallModule,
    ClubOrdersModule,
  ],
  controllers: [ClubScanOrderingController],
  providers: [
    ClubScanOrderingService,
    ClubScanOrderingCartService,
    ClubScanOrderingMenuQueryService,
    ClubScanOrderingServiceCallService,
    ClubScanOrderingOrderService,
    ClubScanOrderingOrderQueryService,
    ClubScanOrderingOrderHistoryService,
    ClubScanOrderingOrderPreviewService,
    ClubScanOrderingCartPricingService,
    ClubScanOrderingCheckoutService,
    ClubScanOrderingMarketingCustomerService,
    ScanOrderingSaleOrderBridgeService,
    ScanOrderingRealtimeService,
    ScanOrderingUnpaidOrderClosureService,
    ScanOrderingPaymentExpirationService,
    ScanOrderingRefundService,
    ScanOrderingPromotionAdapter,
    ScanOrderingPricingVersionService,
    ScanOrderingGateway,
  ],
  exports: [
    ClubScanOrderingService,
    ClubScanOrderingOrderService,
    ClubScanOrderingMarketingCustomerService,
    ScanOrderingRealtimeService,
    ScanOrderingRefundService,
    ScanOrderingUnpaidOrderClosureService,
    ScanOrderingSaleOrderBridgeService,
    ScanOrderingPromotionAdapter,
    ScanOrderingPricingVersionService,
  ],
})
export class ClubScanOrderingModule {}
