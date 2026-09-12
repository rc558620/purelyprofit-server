import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubScanOrderingModule } from '../scan-ordering/club-scan-ordering.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubSelfOrderingController } from './club-self-ordering.controller';
import { ClubSelfOrderingOrderService } from './club-self-ordering-order.service';
import { ClubSelfOrderingPaymentService } from './club-self-ordering-payment.service';
import { ClubSelfOrderingSessionBridgeService } from './club-self-ordering-session-bridge.service';
import { ClubSelfOrderingService } from './club-self-ordering.service';
import { ClubSelfOrderingMenuService } from './club-self-ordering-menu.service';
import { ProductsModule } from '../../purely-profit/goods/products/products.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    RedisModule,
    ClubStoresModule,
    // 自助下单的商品规格校验与权威定价
    ProductsModule,
    // 复用微信 JSAPI 下单能力（该模块只依赖 StoresModule，无循环依赖）
    ClubWechatPayModule,
    // 复用营销顾客解析（含历史客户认领），避免重复实现这套易错逻辑
    ClubScanOrderingModule,
  ],
  controllers: [ClubSelfOrderingController],
  providers: [
    ClubSelfOrderingService,
    ClubSelfOrderingOrderService,
    ClubSelfOrderingPaymentService,
    ClubSelfOrderingSessionBridgeService,
    ClubSelfOrderingMenuService,
    // 支付落账锁仅依赖 RedisService，直接本地提供，避免引入整个 ClubPaymentsModule
    ClubPaymentLockService,
  ],
  exports: [
    ClubSelfOrderingService,
    ClubSelfOrderingOrderService,
    ClubSelfOrderingPaymentService,
  ],
})
export class ClubSelfOrderingModule {}
