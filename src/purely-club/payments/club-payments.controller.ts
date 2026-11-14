import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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

  // 同 profit 侧回调：一旦被全局限流（默认 100 次/60s/IP）打成 429，
  // 微信会判定通知失败并按策略重投，极端情况下用户已付款却迟迟不开通会员/不落账。
  // 真正的防伪造由验签承担，这里只兜住异常流量，因此单独放宽窗口。
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
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
    // rawBody 用于签名校验（签名消息串包含原始请求体），由 bootstrap 的
    // preParsing hook 在本路由上按需注入。缺失时必须传空串让验签服务
    // fail-closed 拒绝，不能用 JSON.stringify(payload) 重新序列化冒充原始报文：
    // 那样既与微信签名消息串不一致，又会把「路由漏登记 rawBody」的部署故障
    // 伪装成一次普通的验签失败，排查成本极高。
    const rawBody = req.rawBody ?? '';

    return this.clubPaymentsService.handleWechatCallback(
      payload,
      { timestamp, nonce, signature, serial },
      rawBody,
    );
  }
}
