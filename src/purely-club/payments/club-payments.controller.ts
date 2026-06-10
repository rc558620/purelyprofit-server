import { Body, Controller, Headers, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubPaymentsService } from './club-payments.service';
import {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';

@ApiTags('Club / Payments')
@Controller('club/payments')
export class ClubPaymentsController {
  constructor(private readonly clubPaymentsService: ClubPaymentsService) {}

  @Post('wechat/callback')
  @ApiOperation({
    summary: '接收 purely-club 微信支付回调',
    description:
      '服务端校验微信回调签名后，按订单类型驱动 club 充值或服务购买的真实落账；回调头使用 Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Signature。',
  })
  @ApiOkResponse({ type: ClubWechatPaymentCallbackAckDto })
  handleWechatCallback(
    @Body() payload: ClubWechatPaymentCallbackDto,
    @Headers('wechatpay-timestamp') timestamp: string | undefined,
    @Headers('wechatpay-nonce') nonce: string | undefined,
    @Headers('wechatpay-signature') signature: string | undefined,
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    return this.clubPaymentsService.handleWechatCallback(payload, {
      timestamp,
      nonce,
      signature,
    });
  }
}
