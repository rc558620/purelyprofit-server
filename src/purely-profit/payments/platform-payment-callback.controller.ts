// 平台收款统一回调入口：三条收款链路共用一个地址，按支付单号反查业务类型后分发
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformPaymentCallbackService } from './platform-payment-callback.service';

@ApiTags('Profit / Payments')
@Controller('profit/payments')
export class PlatformPaymentCallbackController {
  private readonly logger = new Logger(PlatformPaymentCallbackController.name);

  constructor(
    private readonly callbackService: PlatformPaymentCallbackService,
  ) {}

  @Post('wechat/callback')
  @HttpCode(HttpStatus.OK)
  // 回调来自微信支付服务器，出口 IP 高度集中，促销期间同一 IP 的并发远高于普通用户流量。
  // 一旦被全局限流打成 429，微信会判定通知失败并按策略重投，极端情况下会员已付款却迟迟不开通。
  // 真正的防伪造由验签承担，这里只兜住异常流量，因此单独放宽窗口。
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @ApiOperation({
    summary: '平台收款微信支付回调',
    description:
      '平台会员 / 新客额度等「商家付钱给平台」链路的统一下单回调入口，按支付单号分发入账。',
  })
  async handleWechatCallback(
    @Body() payload: unknown,
    @Req() request: FastifyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ code: string; message?: string }> {
    // rawBody 由 bootstrap 的 preParsing hook 注入：微信验签要求与原始报文逐字节一致，
    // 用反序列化后的 body 重新序列化会因字段顺序 / 空格差异导致验签失败
    const rawBody = (request as { rawBody?: string }).rawBody ?? '';

    const reply = await this.callbackService.handleCallback({
      rawBody,
      headers,
      payload,
    });

    if (reply.code !== 'SUCCESS') {
      this.logger.warn(
        `[平台收款回调] 处理未成功，等待微信重试: ${reply.message ?? '未知原因'}`,
      );
    }

    return reply;
  }
}
