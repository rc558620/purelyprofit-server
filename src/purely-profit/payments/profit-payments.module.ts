/**
 * ProfitPaymentsModule
 *
 * purelyProfit（商家端 Web）侧的支付能力模块：承载「商家付钱给平台」的
 * 微信 Native 下单、回调解密、支付单状态机与支付模式裁决。
 *
 * 只依赖全局模块（ConfigModule / RedisModule）与基础设施 PrismaModule，
 * 不反向依赖任何业务模块（营销、会员、新客额度等业务模块一律不在此引入），
 * 让短信 / 会员 / 额度等模块都能单向 import 本模块，从根上避免循环依赖。
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformWechatCallbackDecryptorService } from './platform-wechat-callback-decryptor.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentQrCodeService } from './platform-payment-qrcode.service';
import { ProfitPaymentModeService } from './profit-payment-mode.service';
import { ProfitPaymentModeController } from './profit-payment-mode.controller';
import { ProfitPaymentModeDevGuard } from './guards/profit-payment-mode-dev.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ProfitPaymentModeController],
  providers: [
    PlatformWechatNativeService,
    PlatformWechatCallbackDecryptorService,
    PlatformPaymentOrderService,
    // 短信 / 会员 / 新客额度三条充值链路都要把 code_url 渲染成 PNG，统一由本模块导出
    PlatformPaymentQrCodeService,
    ProfitPaymentModeService,
    // dev-only 支付模式调试接口的可用性守卫（生产环境伪装 404），仅供本模块 controller 使用
    ProfitPaymentModeDevGuard,
  ],
  exports: [
    PlatformWechatNativeService,
    PlatformWechatCallbackDecryptorService,
    PlatformPaymentOrderService,
    PlatformPaymentQrCodeService,
    ProfitPaymentModeService,
  ],
})
export class ProfitPaymentsModule {}
