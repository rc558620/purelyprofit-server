import { BadRequestException, Injectable } from '@nestjs/common';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import type { ClubWechatPaymentCallbackDto } from './dto/club-wechat-callback.dto';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from './club-payments.types';

@Injectable()
export class ClubPaymentCallbackDispatchService {
  constructor(
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
  ) {}

  dispatchWechatCallback(
    payload: ClubWechatPaymentCallbackDto,
  ): Promise<ClubPaymentCallbackResult> {
    return this.resolveCallbackHandler(payload.orderType)(
      payload.orderNo,
      this.buildSettlementParams(payload),
    );
  }

  private buildSettlementParams(
    payload: ClubWechatPaymentCallbackDto,
  ): ClubPaymentCallbackSettlementParams {
    const callbackReceivedAtMs = Date.now();

    return {
      amountFen: payload.amountFen,
      transactionId: payload.transactionId,
      paidAtMs: this.resolvePaidAtMs(payload.paidAt, callbackReceivedAtMs),
      callbackReceivedAtMs,
    };
  }

  private resolveCallbackHandler(
    orderType: ClubWechatPaymentCallbackDto['orderType'],
  ): (
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ) => Promise<ClubPaymentCallbackResult> {
    if (orderType === 'recharge') {
      return async (
        orderNo: string,
        params: ClubPaymentCallbackSettlementParams,
      ): Promise<ClubPaymentCallbackResult> =>
        this.clubRechargePaymentService.confirmOrderPaidByCallback(
          orderNo,
          params,
        );
    }

    return async (
      orderNo: string,
      params: ClubPaymentCallbackSettlementParams,
    ): Promise<ClubPaymentCallbackResult> =>
      this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
        orderNo,
        params,
      );
  }

  private resolvePaidAtMs(
    paidAt: string | undefined,
    fallbackMs: number,
  ): number {
    if (!paidAt) {
      return fallbackMs;
    }

    const parsed = Date.parse(paidAt);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('paidAt 不是合法时间');
    }

    return parsed;
  }
}
