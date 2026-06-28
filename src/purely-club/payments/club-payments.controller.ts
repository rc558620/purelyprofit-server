import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClubPaymentsService } from './club-payments.service';
import {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';

/** Minimal interface for raw body access (Fastify adapter with per-route rawBody) */
interface RawBodyRequest {
  rawBody?: string;
  body?: unknown;
}

@ApiTags('Club / Payments')
@Controller('club/payments')
export class ClubPaymentsController {
  constructor(private readonly clubPaymentsService: ClubPaymentsService) {}

  @Post('wechat/callback')
  @ApiOperation({
    summary: '接收 purely-club 微信支付回调（v3 加密格式）',
    description:
      '微信支付服务器回调入口。服务端校验 Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Signature 签名头时效性，' +
      '解密 resource.ciphertext（AEAD_AES_256_GCM），提取交易结果后驱动充值或服务购买落账。',
  })
  @ApiOkResponse({ type: ClubWechatPaymentCallbackAckDto })
  handleWechatCallback(
    @Body() payload: ClubWechatPaymentCallbackDto,
    @Req() req: RawBodyRequest,
    @Headers('wechatpay-timestamp') timestamp: string | undefined,
    @Headers('wechatpay-nonce') nonce: string | undefined,
    @Headers('wechatpay-signature') signature: string | undefined,
    @Headers('wechatpay-serial') serial: string | undefined,
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    // rawBody 用于签名校验（签名消息串包含原始请求体）
    // 由 Fastify 自定义 content type parser 在微信回调路由上按需注入
    const rawBody = req.rawBody ?? JSON.stringify(payload);

    return this.clubPaymentsService.handleWechatCallback(
      payload,
      { timestamp, nonce, signature, serial },
      rawBody,
    );
  }
}
