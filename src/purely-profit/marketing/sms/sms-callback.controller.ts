import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SmsRechargeCallbackService } from './sms-recharge-callback.service';
import { SmsWechatCallbackAckDto, SmsWechatCallbackDto } from './dto/sms.dto';

/** 原始报文请求的最小结构（Fastify 按路由开启 rawBody 才有 rawBody 字段） */
interface RawBodyRequest {
  rawBody?: string;
  body?: unknown;
}

/**
 * 短信钱包的微信支付回调（**独立路由**）。
 *
 * ⚠️ 刻意不复用 `/api/club/payments/wechat/callback`：那是 purelyClub C 端
 * 订单上下文（充值/服务/扫码点餐/团购券），与 B 端商家短信充值语义完全不同。
 * 混用会让 club 的 RC/SV 订单被当成短信充值单入账。
 *
 * 本路由无 JWT / 权限守卫——调用方是微信支付服务器，靠回调签名 + 解密校验。
 */
@ApiTags('营销中心')
@Controller('marketing/sms')
export class SmsCallbackController {
  constructor(
    private readonly callbackService: SmsRechargeCallbackService,
  ) {}

  @Post('wechat/callback')
  // 微信支付只认 200 / 204 为应答成功，POST 默认返回 201 会被当成失败并反复重投
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '接收短信钱包微信支付回调（v3 加密格式）',
    description:
      '微信支付服务器回调入口。校验 Wechatpay-* 签名头时效性，解密 resource.ciphertext ' +
      '（AEAD_AES_256_GCM），校验 trade_state 与订单号前缀后入账短信钱包。重复投递不会重复入账。',
  })
  @ApiOkResponse({ type: SmsWechatCallbackAckDto })
  handleWechatCallback(
    @Body() payload: SmsWechatCallbackDto,
    @Req() req: RawBodyRequest,
    @Headers('wechatpay-timestamp') timestamp: string | undefined,
    @Headers('wechatpay-nonce') nonce: string | undefined,
    @Headers('wechatpay-signature') signature: string | undefined,
    @Headers('wechatpay-serial') serial: string | undefined,
  ): Promise<SmsWechatCallbackAckDto> {
    // rawBody 用于签名校验：由 bootstrap.ts 在该路由上按需注入（全局 rawBody 关闭）
    const rawBody = req.rawBody ?? JSON.stringify(payload);

    return this.callbackService.handleWechatCallback(
      payload,
      { timestamp, nonce, signature, serial },
      rawBody,
    );
  }
}
