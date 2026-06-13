import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClubPaymentsService } from './club-payments.service';
import {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';

/** Minimal interface for raw body access (compatible with both Express and Fastify adapters) */
interface RawBodyRequest {
  rawBody?: Buffer | string;
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
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    // rawBody 用于签名校验（签名消息串包含原始请求体）
    // NestJS Fastify 适配器在 rawBody 可用时使用原始字节；否则回落到序列化 payload
    const rawBody = req.rawBody
      ? Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString('utf8')
        : req.rawBody
      : JSON.stringify(payload);

    return this.clubPaymentsService.handleWechatCallback(
      payload,
      { timestamp, nonce, signature },
      rawBody,
    );
  }
}
