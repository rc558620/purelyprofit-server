/**
 * ProfitPaymentsModule
 *
 * purelyProfit（商家端 Web）侧的支付能力模块：承载「商家付钱给平台」的
 * 微信 Native 下单、回调解密、支付单状态机与支付模式裁决。
 *
 * 依赖：全局模块（ConfigModule / RedisModule）、基础设施 PrismaModule，
 * 以及 AuthModule —— 仅为了拿它导出的 JwtModule 给支付结果实时网关校验连接身份。
 * 仍不反向依赖会员 / 营销 / 额度等业务模块，让这些模块能单向 import 本模块；
 * AuthModule 的依赖子树（PassportModule / PlatformMembershipAccessModule /
 * StoreBusinessCapabilityModule）均不反向依赖本模块，因此不会成环。
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
// AuthModule 导出 JwtModule：平台收款网关需要 JwtService 校验连接身份
import { AuthModule } from '../auth/auth.module';
// CommerceModule 导出 CommerceAccessService：网关订阅短信充值单时按门店校验归属
import { CommerceModule } from '../commerce/commerce.module';
import { PlatformWechatPayHttpService } from './platform-wechat-pay-http.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformWechatCallbackDecryptorService } from './platform-wechat-callback-decryptor.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentQrCodeService } from './platform-payment-qrcode.service';
import { ProfitPaymentModeService } from './profit-payment-mode.service';
import { ProfitPaymentModeController } from './profit-payment-mode.controller';
import { ProfitPaymentModeDevGuard } from './guards/profit-payment-mode-dev.guard';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';
import { PlatformPaymentGateway } from './platform-payment.gateway';

@Module({
  imports: [PrismaModule, AuthModule, CommerceModule],
  controllers: [ProfitPaymentModeController],
  providers: [
    // 微信 API v3 传输层（签名 / 私钥 / 超时 / 错误解析），供下单、查单、关单共用
    PlatformWechatPayHttpService,
    PlatformWechatNativeService,
    PlatformWechatCallbackDecryptorService,
    PlatformPaymentOrderService,
    // 短信 / 会员 / 新客额度三条充值链路都要把 code_url 渲染成 PNG，统一由本模块导出
    PlatformPaymentQrCodeService,
    ProfitPaymentModeService,
    // dev-only 支付模式调试接口的可用性守卫（生产环境伪装 404），仅供本模块 controller 使用
    ProfitPaymentModeDevGuard,
    // 支付结果实时推送：回调入账后主动推给商家端页面，替代下单后的轮询
    PlatformPaymentRealtimeService,
    PlatformPaymentGateway,
  ],
  exports: [
    PlatformWechatNativeService,
    PlatformWechatCallbackDecryptorService,
    PlatformPaymentOrderService,
    PlatformPaymentQrCodeService,
    ProfitPaymentModeService,
    PlatformPaymentRealtimeService,
  ],
})
export class ProfitPaymentsModule {}
