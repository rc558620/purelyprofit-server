import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';
import { ClubWechatJsapiService } from './club-wechat-jsapi.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatRefundService } from './club-wechat-refund.service';
import { ClubWechatTransactionService } from './club-wechat-transaction.service';
import { ClubWechatVerifyService } from './club-wechat-verify.service';

/**
 * ClubWechatPayModule
 *
 * 独立的微信支付功能模块，不依赖 ClubOrdersModule / ClubRechargeModule，
 * 避免循环依赖。
 *
 * 服务商改造后的依赖层次：
 *   IdentityService（谁有资格收这笔钱）
 *     → PayHttpService（用什么密钥签名、怎么发请求）
 *     → Jsapi（下单） / Transaction（查单关单） / Refund（退款）
 * 四个调用点都不允许自行判断商户号口径。
 *
 * 导出：
 * - ClubWechatJsapiService：JSAPI 下单（下单链路）
 * - ClubWechatTransactionService：查单 / 关单（支付结果核对与超时关单链路）
 * - ClubWechatVerifyService：回源微信核对并给出落账快照（前端「结果未知」时的确认链路）
 * - ClubWechatPayHttpService：团购券退款模块等外部注入方需要自建 refund 实例时复用签名层
 * - ClubWechatRefundService：微信原路退款（团购券 / 扫码点餐共用）
 */
@Module({
  imports: [PrismaModule, StoresModule],
  providers: [
    ClubPaymentOrderRecordService,
    ClubWechatPayHttpService,
    ClubWechatPayIdentityService,
    ClubWechatJsapiService,
    ClubWechatTransactionService,
    ClubWechatRefundService,
    ClubWechatVerifyService,
  ],
  exports: [
    ClubWechatJsapiService,
    ClubWechatTransactionService,
    ClubWechatVerifyService,
    ClubWechatPayHttpService,
    ClubWechatPayIdentityService,
    ClubWechatRefundService,
    // 回调链路（ClubPaymentsModule）也要读写订单的 sp/sub_mch_id，
    // 由本模块统一提供，避免两处各注册一份
    ClubPaymentOrderRecordService,
  ],
})
export class ClubWechatPayModule {}
