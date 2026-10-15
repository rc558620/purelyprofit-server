import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SMS_DELIVERY_CALLBACK_PATH } from './sms.constants';
import { SmsDeliveryCallbackService } from './sms-delivery-callback.service';
import type { SmsDeliveryCallbackResponseDto } from './dto/sms-delivery-callback.dto';

/**
 * 腾讯云短信**送达状态回执**回调。
 *
 * 与充值回调一样**不带 JWT 守卫**：这是腾讯云服务器公网直推的，它没有我们的登录态。
 * 但充值回调至少还有微信支付签名可验，短信回执没有签名，所以防护靠两点：
 * 1. 不易猜的路径（`marketing/sms/tencent/delivery-callback`）；
 * 2. 可选的 `sms.deliveryCallbackToken` 口令校验。
 *
 * 即便被恶意打，能造成的后果也有限：回执匹配不到真实 serialNo 就什么都改不了，
 * 匹配到了也只是「把扣错的钱退回去」——不存在凭空加钱的写入路径。
 *
 * ⚠️ 响应必须是 `{ result: 0 }`：腾讯云拿不到这个响应会持续重推同一批回执。
 */
@ApiTags('营销中心')
@Controller(SMS_DELIVERY_CALLBACK_PATH)
export class SmsDeliveryCallbackController {
  private readonly logger = new Logger(SmsDeliveryCallbackController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryCallbackService: SmsDeliveryCallbackService,
  ) {}

  @Post()
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: '腾讯云短信送达状态回执回调（公网，无鉴权，靠路径+口令防护）',
  })
  async handleDeliveryCallback(
    @Body() body: unknown,
    @Headers('x-sms-delivery-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ): Promise<SmsDeliveryCallbackResponseDto> {
    this.assertToken(headerToken ?? queryToken);

    const result = await this.deliveryCallbackService.handleCallback(body);

    // unmatched / unknown 都要告警：前者意味着这条短信永远不知道有没有送到，
    // 后者意味着状态码没覆盖到——两种情况都会让本该退的钱退不回去。
    if (result.unmatched > 0 || result.unknown > 0) {
      this.logger.warn(
        `[sms-delivery] 回执处理完成 received=${result.received} matched=${result.matched} ` +
          `unmatched=${result.unmatched} unknown=${result.unknown} ` +
          `delivered=${result.delivered} failed=${result.failed} ` +
          `duplicated=${result.duplicated}`,
      );
    }

    return { result: 0, errmsg: 'OK' };
  }

  /**
   * 口令校验：没配置就放行（靠路径防护），配置了就必须对得上。
   *
   * 用 `length` 而不是真值判断，避免配了空格变成「永不校验」的假安全。
   */
  private assertToken(token?: string): void {
    const expected = this.configService.get<string>(
      'sms.deliveryCallbackToken',
    );
    if (typeof expected !== 'string' || expected.trim() === '') {
      return;
    }
    if (token !== expected) {
      throw new UnauthorizedException('Invalid delivery callback token');
    }
  }
}
