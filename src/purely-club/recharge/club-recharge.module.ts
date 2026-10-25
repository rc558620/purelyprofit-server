import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubOrdersModule } from '../orders/club-orders.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubWechatPayModule } from '../payments/club-wechat-pay.module';
import { ClubPaymentModeModule } from '../payments/club-payment-mode.module';
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
    AuthModule,
    PrismaModule,
    ClubStoresModule,
    ClubOrdersModule,
    ClubWechatPayModule,
    // 手动确认支付的闸门由支付模式服务裁决（配置开关 && 运行期模式）
    ClubPaymentModeModule,
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
