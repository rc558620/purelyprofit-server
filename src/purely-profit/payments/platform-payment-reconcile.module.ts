/**
 * PlatformPaymentReconcileModule
 *
 * 平台收款对账的装配层。
 *
 * 与 `PlatformPaymentCallbackModule` 同构、同理由：对账既要用到支付侧
 * （查单 / 关单 / 支付单 / 实时推送），又要调用业务侧入账（额度 / 会员）。
 * 放进 ProfitPaymentsModule 会让支付模块反向依赖业务模块，与
 * 「业务模块 import 支付模块」形成环；独立成单向的顶层模块即可两个方向都不成环。
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NewCustomerQuotaModule } from '../member/new-customer-quota/new-customer-quota.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { PlatformPaymentReconcileSettlementService } from './platform-payment-reconcile-settlement.service';
import { PlatformPaymentReconcileService } from './platform-payment-reconcile.service';
import { ProfitPaymentsModule } from './profit-payments.module';

@Module({
  imports: [
    PrismaModule,
    ProfitPaymentsModule,
    NewCustomerQuotaModule,
    PlatformMembershipModule,
  ],
  providers: [
    PlatformPaymentReconcileSettlementService,
    PlatformPaymentReconcileService,
  ],
  exports: [PlatformPaymentReconcileService],
})
export class PlatformPaymentReconcileModule {}
