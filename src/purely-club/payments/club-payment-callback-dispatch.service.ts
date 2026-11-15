import { BadRequestException, Injectable } from '@nestjs/common';
import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';
import {
  ORDER_NO_PATTERN,
  resolveClubOrderTypeByOrderNo,
} from './club-order-no.constants';
import { ClubCardOrderService } from '../cards/club-card-order.service';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import { ClubScanOrderingPaymentService } from '../scan-ordering/club-scan-ordering-payment.service';
import { ClubSelfOrderingPaymentService } from '../self-ordering/club-self-ordering-payment.service';
import { ClubVoucherOrdersService } from '../voucher-orders/club-voucher-orders.service';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from './club-payments.types';

// 保持既有调用方的导入路径可用；常量本身收敛在无依赖的 club-order-no.constants 中。
export {
  ORDER_NO_PATTERN,
  resolveClubOrderTypeByOrderNo,
} from './club-order-no.constants';
export type { ClubOrderTypeByOrderNo } from './club-order-no.constants';

@Injectable()
export class ClubPaymentCallbackDispatchService {
  constructor(
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
    private readonly clubScanOrderingPaymentService: ClubScanOrderingPaymentService,
    private readonly clubSelfOrderingPaymentService: ClubSelfOrderingPaymentService,
    private readonly clubVoucherOrdersService: ClubVoucherOrdersService,
    private readonly clubCardOrderService: ClubCardOrderService,
  ) {}

  /**
   * 根据订单号前缀路由到对应的落账服务。
   *
   * 订单号格式：
   *   RC{timestamp}{random} — 充值单
   *   SV{timestamp}{random} — 服务购买单
   *   SO{timestamp}{random} — 扫码点餐单
   *   VC{timestamp}{random} — 团购券单
   *   SF{timestamp}{random} — 空间自助下单
   *   MC{timestamp}{random} — C 端购卡单
   */
  dispatchByOrderNo(
    orderNo: string,
    settlementParams: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubPaymentCallbackResult> {
    if (!ORDER_NO_PATTERN.test(orderNo)) {
      throw new BadRequestException(
        clubPayError(
          CLUB_PAY_ERROR_CODE.PARAM_ORDER_NO_FORMAT_INVALID,
          `订单号格式异常: ${orderNo}（期望格式 RC/SV/SO/VC + 时间戳 + 随机HEX）`,
        ),
      );
    }

    const orderType = resolveClubOrderTypeByOrderNo(orderNo);

    if (orderType === 'recharge') {
      return this.clubRechargePaymentService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }
    if (orderType === 'scan_ordering') {
      return this.clubScanOrderingPaymentService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }
    if (orderType === 'self_ordering') {
      return this.clubSelfOrderingPaymentService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }
    if (orderType === 'voucher') {
      return this.clubVoucherOrdersService.confirmVoucherOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }
    if (orderType === 'card') {
      return this.clubCardOrderService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }
    return this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
      orderNo,
      settlementParams,
    );
  }
}
