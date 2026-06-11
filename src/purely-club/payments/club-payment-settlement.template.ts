import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type { ClubOrderTypeValue } from '../orders/club-order.types';
import { shouldRefreshPaidObservation } from './club-payments.utils';

export abstract class ClubPaymentSettlementTemplate<
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
  TResult,
> {
  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly clubOrderDraftsService: ClubOrderDraftsService,
    protected readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async completePaidDraft(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): Promise<TResult> {
    if (draft.status === 'paid') {
      const observedPaidDraft = shouldRefreshPaidObservation(paymentMeta)
        ? await this.clubOrderDraftsService.markPaid(draft, paymentMeta)
        : draft;
      return this.toResponse(observedPaidDraft);
    }

    this.assertDraftPayable(draft.status);

    if (!draft.customerId) {
      throw new NotFoundException(this.memberNotFoundMessage);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.persistPaidDraft(tx, draft);
    });
    await this.cacheInvalidatorService.invalidateMarketingOverview(
      draft.storeId,
    );

    const paidDraft = await this.clubOrderDraftsService.markPaid(
      draft,
      paymentMeta,
    );
    return this.toResponse(paidDraft);
  }

  protected abstract readonly memberNotFoundMessage: string;

  protected abstract assertDraftPayable(
    status: ClubOrderStatusResponseDto['status'],
  ): void;

  protected abstract persistPaidDraft(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  ): Promise<void>;

  protected abstract toResponse(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  ): TResult;
}
