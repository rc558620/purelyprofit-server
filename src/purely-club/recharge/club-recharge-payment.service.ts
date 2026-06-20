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
          orderNo: string,
        ) =>
          this.clubRechargeQueryService.getRechargeDraft(
            currentContext,
            orderNo,
          ),
        loadDraftByOrderNo: (orderNo: string) =>
          this.clubRechargeQueryService.getRechargeDraftByOrderNo(orderNo),
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
    orderNo: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaid(
      currentContext,
      orderNo,
    );
  }

  confirmOrderPaidByCallback(
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaidByCallback(
      orderNo,
      params,
    );
  }
}
