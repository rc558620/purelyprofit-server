import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClubOrderPaidObservationOptions } from '../orders/club-order-drafts.types';
import type { ClubPaymentCallbackSettlementParams } from './club-payments.types';
import { assertClubPaymentAmountMatches } from './club-payments.utils';

interface ClubPaymentConfirmationOrchestratorParams<
  TConfirmInput,
  TDraft,
  TResult,
> {
  configService: ConfigService;
  loadDraftForManualConfirm: (
    input: TConfirmInput,
    orderNo: string,
  ) => Promise<TDraft>;
  loadDraftByOrderNo: (orderNo: string) => Promise<TDraft>;
  resolveDraftAmountFen: (draft: TDraft) => number;
  completePaidDraft: (
    draft: TDraft,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ) => Promise<TResult>;
}

export class ClubPaymentConfirmationOrchestrator<
  TConfirmInput,
  TDraft,
  TResult,
> {
  constructor(
    private readonly params: ClubPaymentConfirmationOrchestratorParams<
      TConfirmInput,
      TDraft,
      TResult
    >,
  ) {}

  async confirmOrderPaid(
    input: TConfirmInput,
    orderNo: string,
  ): Promise<TResult> {
    // 开发态兜底开关：手动 confirm-paid 只能用于本地/联调。
    // 生产环境该开关必须为 false（bootstrap 生产配置校验已强制），
    // 否则任意持单号的人都能把订单标记成已支付并真实落账。
    const manualConfirmPaidEnabled =
      this.params.configService.get<boolean>('club.manualConfirmPaidEnabled') ??
      false;
    if (!manualConfirmPaidEnabled) {
      throw new ForbiddenException(
        '当前环境未开启手动确认支付，请通过支付回调驱动落账',
      );
    }

    const draft = await this.params.loadDraftForManualConfirm(input, orderNo);
    return this.params.completePaidDraft(draft, {
      paymentConfirmationSource: 'manual_confirm_paid',
    });
  }

  async confirmOrderPaidByCallback(
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<TResult> {
    const draft = await this.params.loadDraftByOrderNo(orderNo);

    assertClubPaymentAmountMatches(
      this.params.resolveDraftAmountFen(draft),
      params.amountFen,
    );

    return this.params.completePaidDraft(draft, {
      paidAtMs: params.paidAtMs,
      paymentTransactionId: params.transactionId,
      callbackReceivedAtMs: params.callbackReceivedAtMs,
      paymentConfirmationSource: 'wechat_callback',
    });
  }
}
