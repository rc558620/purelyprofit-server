import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type { ClubOrderTypeValue } from '../orders/club-order.types';
import { ClubPaymentLockService } from './club-payment-lock.service';
import { shouldRefreshPaidObservation } from './club-payments.utils';

const CLUB_PAYMENT_ALREADY_PROCESSING_MESSAGE = '订单正在处理中，请勿重复操作';

export abstract class ClubPaymentSettlementTemplate<
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
  TResult,
> {
  protected readonly logger = new Logger(ClubPaymentSettlementTemplate.name);

  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly clubOrderDraftsService: ClubOrderDraftsService,
    protected readonly cacheInvalidatorService: CacheInvalidatorService,
    protected readonly paymentLockService: ClubPaymentLockService,
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

    // 获取分布式锁，防止并发回调/重复 confirm 导致重复落账
    const lockToken = await this.paymentLockService.acquireLock(draft.orderNo);
    if (!lockToken) {
      this.logger.warn(
        `订单 ${draft.orderNo} 正在被并发处理，拒绝本次落账请求`,
      );
      throw new BadRequestException(CLUB_PAYMENT_ALREADY_PROCESSING_MESSAGE);
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await this.persistPaidDraft(tx, draft);
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      );
      await this.cacheInvalidatorService.invalidateMarketingOverview(
        draft.storeId,
      );

      const paidDraft = await this.clubOrderDraftsService.markPaid(
        draft,
        paymentMeta,
      );
      return this.toResponse(paidDraft);
    } finally {
      await this.paymentLockService.releaseLock(draft.orderNo, lockToken);
    }
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
