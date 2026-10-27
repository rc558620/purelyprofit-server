import { Module } from '@nestjs/common';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { ClubWechatJsapiService } from './club-wechat-jsapi.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatTransactionService } from './club-wechat-transaction.service';
import { ClubWechatVerifyService } from './club-wechat-verify.service';

/**
 * ClubWechatPayModule
 *
 * 独立的微信支付功能模块，不依赖 ClubOrdersModule / ClubRechargeModule，
 * 避免循环依赖。
 *
 * 导出：
 * - ClubWechatJsapiService：JSAPI 下单（下单链路）
 * - ClubWechatTransactionService：查单 / 关单（支付结果核对与超时关单链路）
 * - ClubWechatVerifyService：回源微信核对并给出落账快照（前端「结果未知」时的确认链路）
 */
@Module({
  imports: [StoresModule],
  providers: [
    ClubWechatPayHttpService,
    ClubWechatJsapiService,
    ClubWechatTransactionService,
    ClubWechatVerifyService,
  ],
  exports: [
    ClubWechatJsapiService,
    ClubWechatTransactionService,
    ClubWechatVerifyService,
  ],
})
export class ClubWechatPayModule {}
