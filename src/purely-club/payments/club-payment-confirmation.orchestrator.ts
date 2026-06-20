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
    this.ensureManualConfirmPaidEnabled();
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

  private ensureManualConfirmPaidEnabled(): void {
    const enabled =
      this.params.configService.get<boolean>('club.manualConfirmPaidEnabled') ??
      false;
    if (!enabled) {
      throw new ForbiddenException(
        'confirm-paid 仅开发态可用，请改用支付回调驱动订单状态刷新',
      );
    }
  }
}
