/**
 * PlatformPaymentCallbackModule
 *
 * 平台收款回调的装配层。
 *
 * 之所以单独成模块：回调分发既要用到支付侧（验签 / 解密 / 支付单），
 * 又要调用业务侧入账（额度 / 会员）。把它放在 ProfitPaymentsModule 里会让
 * 支付模块反向依赖业务模块，从而与「业务模块 import 支付模块」形成环。
 * 独立成单向的顶层模块即可两个方向都依赖而不成环。
 */
import { Module } from '@nestjs/common';
import { ClubPaymentCallbackSignatureService } from '../../purely-club/payments/club-payment-callback-signature.service';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { NewCustomerQuotaModule } from '../member/new-customer-quota/new-customer-quota.module';
import { PlatformPaymentCallbackController } from './platform-payment-callback.controller';
import { PlatformPaymentCallbackService } from './platform-payment-callback.service';
import { ProfitPaymentsModule } from './profit-payments.module';

@Module({
  imports: [
    ProfitPaymentsModule,
    NewCustomerQuotaModule,
    PlatformMembershipModule,
  ],
  controllers: [PlatformPaymentCallbackController],
  providers: [
    PlatformPaymentCallbackService,
    // 验签实现与 club 侧同源（平台公钥，无门店上下文），本地提供避免牵出整个 club 模块
    ClubPaymentCallbackSignatureService,
  ],
})
export class PlatformPaymentCallbackModule {}
