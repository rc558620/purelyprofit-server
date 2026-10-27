import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type {
  ClubRechargeOrderResponseDto,
  ClubRechargeOrderStatusQueryDto,
  ClubRechargePackagesResponseDto,
  CreateClubRechargeOrderDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';
import { ClubRechargeCreationService } from './club-recharge-creation.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

@Injectable()
export class ClubRechargeService {
  constructor(
    private readonly clubRechargeCreationService: ClubRechargeCreationService,
    private readonly clubRechargeQueryService: ClubRechargeQueryService,
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
    private readonly clubRechargeWechatVerifyService: ClubRechargeWechatVerifyService,
  ) {}

  listPackages(
    currentContext: ClubCurrentContext,
    query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    return this.clubRechargeQueryService.listPackages(currentContext, query);
  }

  createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargeCreationService.createOrder(currentContext, dto);
  }

  /**
   * 查询充值订单状态。
   *
   * `verify=1` 时回微信侧核对真实支付结果（D2）：
   * `wx.requestPayment` 结果未知时，用户可能已扣款，前端不能按失败引导重试。
   *
   * ⚠️ 核对前必须先按当前用户维度取到订单：微信查单只认订单号，
   * 若直接把前端传来的 id 交给核对服务，等于开放了按订单号探测他人订单的接口。
   */
  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
    query: ClubRechargeOrderStatusQueryDto,
  ): Promise<ClubOrderStatusResponseDto> {
    const draft = await this.clubRechargeQueryService.getRechargeDraft(
      currentContext,
      orderId,
    );

    if (query.verify) {
      return this.clubRechargeWechatVerifyService.verifyAndSettle({
        orderNo: draft.orderNo,
      });
    }

    return this.clubRechargeQueryService.toRechargeOrderResponse(draft);
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargePaymentService.confirmOrderPaid(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaidByCallback(
    orderId: string,
    params: {
      amountFen: number;
      transactionId: string;
      paidAtMs: number;
      callbackReceivedAtMs: number;
    },
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargePaymentService.confirmOrderPaidByCallback(
      orderId,
      params,
    );
  }
}
