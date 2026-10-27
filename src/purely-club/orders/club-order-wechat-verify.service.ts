/**
 * 服务订单「微信侧主动核对 + 补落账」。
 *
 * 服务订单的支付凭证存在 Redis 草稿里（无独立支付尝试表），
 * out_trade_no 就是草稿的 orderNo，金额取草稿的 amountFen。
 *
 * 只核对 pending：paid 已终结，failed / cancelled / expired 都不可再支付。
 */
import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import { ClubOrderServicePaymentService } from './club-order-service-payment.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import type { ClubOrderStatusValue } from './club-order.types';

/** 可核对状态：其余状态已终结或不可支付，回源微信没有意义 */
const VERIFIABLE_STATUSES: readonly ClubOrderStatusValue[] = ['pending'];

@Injectable()
export class ClubOrderWechatVerifyService {
  constructor(
    private readonly clubOrderServiceQueryService: ClubOrderServiceQueryService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
    private readonly clubWechatVerifyService: ClubWechatVerifyService,
  ) {}

  /**
   * 回微信侧核对服务订单，确认已支付则补落账。
   *
   * @returns true 表示本次确实补了落账（调用方据此决定是否需要重查）
   */
  async verifyAndSettle(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<boolean> {
    const draft = await this.clubOrderServiceQueryService.getServiceDraft(
      currentContext,
      orderId,
    );

    if (!VERIFIABLE_STATUSES.includes(draft.status)) {
      return false;
    }

    const verified = await this.clubWechatVerifyService.confirmPaidOnWechat({
      scope: 'service',
      storeId: draft.storeId,
      outTradeNo: draft.orderNo,
      expectedAmountFen: draft.amountFen,
    });

    if (!verified) {
      return false;
    }

    await this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
      draft.orderNo,
      { ...verified, callbackReceivedAtMs: Date.now() },
    );

    return true;
  }
}
