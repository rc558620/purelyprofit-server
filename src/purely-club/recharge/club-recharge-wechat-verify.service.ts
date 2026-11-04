/**
 * 充值订单「微信侧主动核对 + 补落账」服务（D2 / D3）。
 *
 * 核对逻辑本身由 {@link ClubWechatVerifyService} 统一实现：节流、查单、交易状态判定、
 * 金额与流水号一致性校验、金额不一致告警。本服务只负责把充值草稿翻译成核对入参，
 * 并在核对通过后驱动充值落账、组装订单响应。
 *
 * 为什么充值侧不能自己再写一遍：历史实现把上述四步完整复制了一份，
 * 导致「金额不一致绝不落账」这条资金口径存在两份实现，修正只会落在其中一份。
 */
import { Injectable } from '@nestjs/common';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import type { ClubOrderStatusValue } from '../orders/club-order.types';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';

/** 只有处于这两个状态的订单才值得回微信核对：paid 已终结，failed/cancelled 不可支付 */
const VERIFIABLE_STATUSES: readonly ClubOrderStatusValue[] = [
  'pending',
  'expired',
];

@Injectable()
export class ClubRechargeWechatVerifyService {
  constructor(
    private readonly clubWechatVerifyService: ClubWechatVerifyService,
    private readonly clubRechargeQueryService: ClubRechargeQueryService,
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
  ) {}

  /**
   * 核对订单在微信侧的真实状态，必要时补落账。
   *
   * @param params.orderNo 业务订单号（微信 out_trade_no）
   * @param params.force   跳过节流，立即核对（管理端人工补单用）
   * @returns 核对后（可能已落账）的订单状态
   */
  async verifyAndSettle(params: {
    orderNo: string;
    force?: boolean;
  }): Promise<ClubRechargeOrderResponseDto> {
    const draft = await this.clubRechargeQueryService.getRechargeDraftByOrderNo(
      params.orderNo,
    );

    if (!VERIFIABLE_STATUSES.includes(draft.status)) {
      return this.clubRechargeQueryService.toRechargeOrderResponse(draft);
    }

    const verified = await this.clubWechatVerifyService.confirmPaidOnWechat({
      scope: 'recharge',
      storeId: draft.storeId,
      outTradeNo: draft.orderNo,
      expectedAmountFen: draft.amountFen,
      force: params.force,
    });

    // 未支付 / 查不到 / 数据不一致 / 节流命中：
    // 保持本地状态，前端继续按「等待确认」展示，不谎报成功也不谎报失败
    if (!verified) {
      return this.clubRechargeQueryService.toRechargeOrderResponse(draft);
    }

    return this.clubRechargePaymentService.confirmOrderPaidByCallback(
      draft.orderNo,
      {
        amountFen: verified.amountFen,
        transactionId: verified.transactionId,
        paidAtMs: verified.paidAtMs,
        callbackReceivedAtMs: Date.now(),
      },
    );
  }
}
