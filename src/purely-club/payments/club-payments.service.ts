import { Injectable } from '@nestjs/common';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import type {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';
import type {
  ClubPaymentCallbackResult,
  ClubWechatCallbackHeaders,
} from './club-payments.types';

@Injectable()
export class ClubPaymentsService {
  constructor(
    private readonly clubPaymentCallbackSignatureService: ClubPaymentCallbackSignatureService,
    private readonly clubPaymentCallbackDispatchService: ClubPaymentCallbackDispatchService,
  ) {}

  async handleWechatCallback(
    payload: ClubWechatPaymentCallbackDto,
    headers: ClubWechatCallbackHeaders,
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    this.clubPaymentCallbackSignatureService.assertWechatCallbackSignature(
      payload,
      headers,
    );
    const order =
      await this.clubPaymentCallbackDispatchService.dispatchWechatCallback(payload);
    return this.toCallbackAck(order);
  }

  private toCallbackAck(
    order: ClubPaymentCallbackResult,
  ): ClubWechatPaymentCallbackAckDto {
    return {
      success: true,
      orderNo: order.orderNo,
      orderType: order.orderType,
      status: order.status,
    };
  }
}
