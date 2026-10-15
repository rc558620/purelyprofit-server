import { Module } from '@nestjs/common';
import { ClubPaymentCallbackSignatureService } from '../../../purely-club/payments/club-payment-callback-signature.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { MarketingModule } from '../marketing.module';
import { SmsAccountService } from './sms-account.service';
import { SmsDeliveryCallbackController } from './sms-delivery-callback.controller';
import { SmsDeliveryCallbackService } from './sms-delivery-callback.service';
import { SmsDeliveryReconcileService } from './sms-delivery-reconcile.service';
import { SmsBroadcastQueryService } from './sms-broadcast-query.service';
import { SmsBroadcastRecoveryService } from './sms-broadcast-recovery.service';
import { SmsBroadcastService } from './sms-broadcast.service';
import { SmsCallbackController } from './sms-callback.controller';
import { SmsQuoteService } from './sms-quote.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsRechargeService } from './sms-recharge.service';
import { SmsTencentProvider } from './sms-tencent.provider';
import { SmsWalletService } from './sms-wallet.service';
import { SmsWechatCallbackDecryptorService } from './sms-wechat-callback-decryptor.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';
import { SmsController } from './sms.controller';

/**
 * 群发短信模块。
 *
 * 依赖说明：
 * - MarketingModule：复用 `MarketingSharedService` 解析门店（前端不传 storeId）
 * - 微信支付走**平台商户号**（wechat.payMchId / wechat.payApiV3Key）：
 *   商家充值是付钱给平台，与门店微信收款（stores_wechat_pay，C 端顾客付钱
 *   给商家）是两条资金流，因此本模块**不依赖 StoresModule**。
 * - 验签复用 purely-club 的现有实现（用平台公钥，无门店上下文）；
 *   解密用短信专用解密器（平台 APIv3Key，club 的解密器遍历门店密钥不适用）。
 */
@Module({
  imports: [PrismaModule, RedisModule, MarketingModule],
  controllers: [
    SmsController,
    SmsCallbackController,
    SmsDeliveryCallbackController,
  ],
  providers: [
    SmsAccountService,
    SmsQuoteService,
    SmsBroadcastService,
    SmsBroadcastRecoveryService,
    SmsBroadcastQueryService,
    SmsDeliveryCallbackService,
    SmsDeliveryReconcileService,
    SmsRefundService,
    SmsRechargeService,
    SmsWalletService,
    SmsTencentProvider,
    SmsWechatNativeService,
    SmsWechatCallbackDecryptorService,
    ClubPaymentCallbackSignatureService,
  ],
  // SmsBroadcastRecoveryService 供 QueueModule 的补偿定时任务使用
  exports: [
    SmsAccountService,
    SmsBroadcastRecoveryService,
    SmsDeliveryReconcileService,
  ],
})
export class SmsModule {}
