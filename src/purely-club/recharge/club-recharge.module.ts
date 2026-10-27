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
import { ClubRechargeExpirationService } from './club-recharge-expiration.service';
import { ClubRechargeOrderStoreService } from './club-recharge-order-store.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeReconciliationService } from './club-recharge-reconciliation.service';
import { ClubRechargeService } from './club-recharge.service';
import { ClubRechargeSettlementService } from './club-recharge-settlement.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';
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
    ClubRechargeOrderStoreService,
    ClubRechargePackagesService,
    ClubRechargePaymentService,
    ClubRechargeQueryService,
    ClubRechargeSettlementService,
    ClubPaymentLockService,
    // 超时订单定时关单（含微信侧关单），随本模块生命周期启停
    ClubRechargeExpirationService,
    // 跨天未决订单对账：以微信查单结果为准补落账，兜住回调丢失 / 死信遗漏
    ClubRechargeReconciliationService,
    // 微信侧主动核对 + 补落账，导出给管理端人工补单入口复用
    ClubRechargeWechatVerifyService,
    ClubRechargeService,
  ],
  exports: [
    ClubRechargePaymentService,
    ClubRechargeService,
    ClubRechargeWechatVerifyService,
  ],
})
export class ClubRechargeModule {}
