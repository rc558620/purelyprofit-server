import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { CommerceModule } from '../../purely-profit/commerce/commerce.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubServiceCallModule } from '../service-call/club-service-call.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubScanOrderingController } from './club-scan-ordering.controller';
import { ClubScanOrderingService } from './club-scan-ordering.service';
import { ClubScanOrderingCartService } from './club-scan-ordering-cart.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ScanOrderingGateway } from './scan-ordering.gateway';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPaymentExpirationService } from './scan-ordering-payment-expiration.service';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';
import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';

@Module({
  imports: [
    AuthModule,
    CommerceModule,
    PrismaModule,
    RedisModule,
    ClubWechatPayModule,
    ClubServiceCallModule,
  ],
  controllers: [ClubScanOrderingController],
  providers: [
    ClubScanOrderingService,
    ClubScanOrderingCartService,
    ClubScanOrderingOrderService,
    ClubScanOrderingCartPricingService,
    ClubScanOrderingCheckoutService,
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
    ScanOrderingRealtimeService,
    ScanOrderingRefundService,
    ScanOrderingPromotionAdapter,
    ScanOrderingPricingVersionService,
  ],
})
export class ClubScanOrderingModule {}
