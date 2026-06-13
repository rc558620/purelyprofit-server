import { BadRequestException, Injectable } from '@nestjs/common';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from './club-payments.types';

/** 订单号前缀 → 订单类型映射 */
const ORDER_NO_TYPE_MAP: Record<string, 'recharge' | 'service'> = {
  RC: 'recharge',
  SV: 'service',
};

@Injectable()
export class ClubPaymentCallbackDispatchService {
  constructor(
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
  ) {}

  /**
   * 根据订单号前缀路由到对应的落账服务。
   *
   * 订单号格式：
   *   RC{timestamp}{random} — 充值单
   *   SV{timestamp}{random} — 服务购买单
   */
  dispatchByOrderNo(
    orderNo: string,
    settlementParams: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubPaymentCallbackResult> {
    const orderType = this.resolveOrderTypeByOrderNo(orderNo);

    if (orderType === 'recharge') {
      return this.clubRechargePaymentService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }

    return this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
      orderNo,
      settlementParams,
    );
  }

  private resolveOrderTypeByOrderNo(orderNo: string): 'recharge' | 'service' {
    const prefix = orderNo.slice(0, 2).toUpperCase();
    const orderType = ORDER_NO_TYPE_MAP[prefix];

    if (!orderType) {
      throw new BadRequestException(
        `无法从订单号识别订单类型: ${orderNo}（期望前缀 RC / SV）`,
      );
    }

    return orderType;
  }
}
