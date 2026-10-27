import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogModule } from '../../shared/audit-log.module';
import { ClubPaymentCallbackFailureModule } from '../../purely-club/payments/club-payment-callback-failure.module';
import { ClubWechatPayModule } from '../../purely-club/payments/club-wechat-pay.module';
import { ClubRechargeModule } from '../../purely-club/recharge/club-recharge.module';
import { PulseClubPaymentAdminController } from './pulse-club-payment-admin.controller';
import { PulseClubPaymentAdminService } from './pulse-club-payment-admin.service';

/**
 * 平台运营支付事故处理模块。
 *
 * 只装配「查单 / 补单 / 死信处理」这一组管理端能力，
 * 不与商家会员域耦合，避免补单入口被业务权限模型牵连。
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    AuditLogModule,
    ClubPaymentCallbackFailureModule,
    ClubWechatPayModule,
    ClubRechargeModule,
  ],
  controllers: [PulseClubPaymentAdminController],
  providers: [PulseClubPaymentAdminService],
})
export class PulseClubPaymentAdminModule {}
