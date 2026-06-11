import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubPaymentSettlementTemplate } from '../payments/club-payment-settlement.template';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';
import {
  CLUB_MEMBER_NOT_FOUND_MESSAGE,
  CLUB_PRODUCT_NOT_FOUND_MESSAGE,
  CLUB_SERVICE_CONFIRM_NOT_ALLOWED_MESSAGE,
} from './club-orders.constants';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
} from './dto/club-order.dto';

@Injectable()
export class ClubOrderSettlementService extends ClubPaymentSettlementTemplate<
  ClubServiceOrderMetadata,
  'service',
  ClubServiceOrderResponseDto
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
      throw new BadRequestException(CLUB_SERVICE_CONFIRM_NOT_ALLOWED_MESSAGE);
    }
  }

  protected async persistPaidDraft(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): Promise<void> {
    const settlementContext = await this.loadSettlementContext(tx, draft);
    await this.recordConsumption(tx, draft, settlementContext.customer.id);
    await this.updateCustomerMetrics(
      tx,
      settlementContext.customer.id,
      settlementContext.customer.totalSpent,
      draft.amountFen,
    );
    await this.decrementProductStock(tx, draft);
    await this.increasePromotionUsage(tx, draft);
  }

  protected toResponse(
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): ClubServiceOrderResponseDto {
    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }

  private async loadSettlementContext(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): Promise<{
    customer: {
      id: number;
      totalSpent: number;
    };
    product: {
      id: number;
      stock: number;
    };
  }> {
    const customer = await tx.marketingCustomer.findFirst({
      where: {
        id: draft.customerId ?? undefined,
        storeId: draft.storeId,
      },
      select: {
        id: true,
        totalSpent: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    const product = await tx.marketingProduct.findFirst({
      where: {
        id: draft.metadata.productId,
        storeId: draft.storeId,
        isActive: true,
      },
      select: {
        id: true,
        stock: true,
      },
    });

    if (!product || product.stock <= 0) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }

    return {
      customer,
      product,
    };
  }

  private async recordConsumption(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    customerId: number,
  ): Promise<void> {
    await tx.marketingConsumption.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: draft.amountFen,
        balancePaid: 0,
        pointsDeducted: 0,
        payType: 'wechat',
        itemsSummary: draft.metadata.productName,
        promotionId: draft.metadata.promotionId,
      },
    });
  }

  private async updateCustomerMetrics(
    tx: Prisma.TransactionClient,
    customerId: number,
    currentTotalSpent: number,
    amountFen: number,
  ): Promise<void> {
    const newTotalSpent = currentTotalSpent + amountFen;
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        totalSpent: { increment: amountFen },
        visitCount: { increment: 1 },
        lastVisitAt: new Date(),
        tier: calcCustomerTier(newTotalSpent) as never,
      },
    });
  }

  private async decrementProductStock(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): Promise<void> {
    await tx.marketingProduct.updateMany({
      where: {
        id: draft.metadata.productId,
        storeId: draft.storeId,
      },
      data: {
        stock: { decrement: 1 },
      },
    });
  }

  private async increasePromotionUsage(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
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
        totalDiscount: { increment: draft.metadata.discountAmountFen },
      },
    });
  }
}
