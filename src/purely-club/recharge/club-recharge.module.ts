import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubRechargeController } from './club-recharge.controller';
import { ClubRechargeContextService } from './club-recharge-context.service';
import { ClubRechargeCreationService } from './club-recharge-creation.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeService } from './club-recharge.service';
import { ClubRechargeSettlementService } from './club-recharge-settlement.service';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    PrismaModule,
    RedisModule,
    ClubStoresModule,
    ClubOrdersModule,
    ClubWechatPayModule,
  ],
  controllers: [ClubRechargeController],
  providers: [
    ClubRechargeContextService,
    ClubRechargeCreationService,
    ClubRechargePackagesService,
    ClubRechargePaymentService,
    ClubRechargeQueryService,
    ClubRechargeSettlementService,
    ClubPaymentLockService,
    ClubRechargeService,
  ],
  exports: [ClubRechargePaymentService, ClubRechargeService],
})
export class ClubRechargeModule {}
