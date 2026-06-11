import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderDraftPayload,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';
import { ClubPaymentConfirmationOrchestrator } from '../payments/club-payment-confirmation.orchestrator';
import { ClubOrderSettlementService } from './club-order-settlement.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import type { ClubServiceOrderResponseDto } from './dto/club-order.dto';

@Injectable()
export class ClubOrderServicePaymentService {
  private readonly paymentConfirmationOrchestrator: ClubPaymentConfirmationOrchestrator<
    ClubCurrentContext,
    ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    ClubServiceOrderResponseDto
  >;

  constructor(
    private readonly configService: ConfigService,
    private readonly clubOrderSettlementService: ClubOrderSettlementService,
    private readonly clubOrderServiceQueryService: ClubOrderServiceQueryService,
  ) {
    this.paymentConfirmationOrchestrator =
      new ClubPaymentConfirmationOrchestrator({
        configService: this.configService,
        loadDraftForManualConfirm: (
          currentContext: ClubCurrentContext,
          orderId: string,
        ) => this.clubOrderServiceQueryService.getServiceDraft(currentContext, orderId),
        loadDraftByOrderId: (orderId: string) =>
          this.clubOrderServiceQueryService.getServiceDraftByOrderId(orderId),
        resolveDraftAmountFen: (draft) => draft.amountFen,
        completePaidDraft: (draft, paymentMeta) =>
          this.clubOrderSettlementService.completePaidDraft(draft, paymentMeta),
      });
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaid(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaidByCallback(
    orderId: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaidByCallback(
      orderId,
      params,
    );
  }
}
