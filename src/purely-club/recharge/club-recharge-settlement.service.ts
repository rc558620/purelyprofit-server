import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import { ClubPaymentSettlementTemplate } from '../payments/club-payment-settlement.template';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import {
  CLUB_MEMBER_NOT_FOUND_MESSAGE,
  CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE,
} from './club-recharge.constants';

@Injectable()
export class ClubRechargeSettlementService extends ClubPaymentSettlementTemplate<
  ClubRechargeOrderMetadata,
  'recharge',
  ClubRechargeOrderResponseDto
> {
  protected readonly memberNotFoundMessage = CLUB_MEMBER_NOT_FOUND_MESSAGE;

  constructor(
    prisma: PrismaService,
    clubOrderDraftsService: ClubOrderDraftsService,
    cacheInvalidatorService: CacheInvalidatorService,
  ) {
    super(prisma, clubOrderDraftsService, cacheInvalidatorService);
  }

  protected assertDraftPayable(
    status: ClubOrderStatusResponseDto['status'],
  ): void {
    if (status !== 'pending') {
      throw new BadRequestException(CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE);
    }
  }

  protected async persistPaidDraft(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<void> {
    const customer = await this.findCustomer(tx, draft);
    await this.createRechargeRecord(tx, draft, customer.id);
    await this.increaseCustomerBalance(tx, draft, customer.id);
    await this.increasePromotionUsage(tx, draft);
  }

  protected toResponse(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): ClubRechargeOrderResponseDto {
    return toClubRechargeOrderResponse(
      this.clubOrderDraftsService.toOrderStatusResponse(draft),
      draft,
    );
  }

  private async findCustomer(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<{ id: number }> {
    const customer = await tx.marketingCustomer.findFirst({
      where: {
        id: draft.customerId ?? undefined,
        storeId: draft.storeId,
      },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    return customer;
  }

  private createRechargeRecord(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    customerId: number,
  ): Promise<unknown> {
    return tx.marketingRecharge.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: draft.metadata.rechargeAmountFen,
        giftAmount: draft.metadata.bonusAmountFen,
        type: 'recharge',
        promotionId: draft.metadata.promotionId,
        note: `club充值订单 ${draft.orderNo}`,
      },
    });
  }

  private increaseCustomerBalance(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    customerId: number,
  ): Promise<unknown> {
    return tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        balance: {
          increment:
            draft.metadata.rechargeAmountFen + draft.metadata.bonusAmountFen,
        },
      },
    });
  }

  private async increasePromotionUsage(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<void> {
    if (!draft.metadata.promotionId) {
      return;
    }

    await tx.marketingPromotion.updateMany({
      where: {
        id: draft.metadata.promotionId,
        storeId: draft.storeId,
      },
      data: {
        usageCount: { increment: 1 },
      },
    });
  }
}
