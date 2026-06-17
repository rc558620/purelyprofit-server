import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';
import { ClubPaymentConfirmationOrchestrator } from '../payments/club-payment-confirmation.orchestrator';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeSettlementService } from './club-recharge-settlement.service';

@Injectable()
export class ClubRechargePaymentService {
  private readonly paymentConfirmationOrchestrator: ClubPaymentConfirmationOrchestrator<
    ClubCurrentContext,
    ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    ClubRechargeOrderResponseDto
  >;

  constructor(
    private readonly configService: ConfigService,
    private readonly clubRechargeQueryService: ClubRechargeQueryService,
    private readonly clubRechargeSettlementService: ClubRechargeSettlementService,
  ) {
    this.paymentConfirmationOrchestrator =
      new ClubPaymentConfirmationOrchestrator({
        configService: this.configService,
        loadDraftForManualConfirm: (
          currentContext: ClubCurrentContext,
          orderId: string,
        ) =>
          this.clubRechargeQueryService.getRechargeDraft(
            currentContext,
            orderId,
          ),
        loadDraftByOrderId: (orderId: string) =>
          this.clubRechargeQueryService.getRechargeDraftByOrderId(orderId),
        resolveDraftAmountFen: (draft) => draft.amountFen,
        completePaidDraft: (draft, paymentMeta) =>
          this.clubRechargeSettlementService.completePaidDraft(
            draft,
            paymentMeta,
          ),
      });
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaid(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaidByCallback(
    orderId: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaidByCallback(
      orderId,
      params,
    );
  }
}
