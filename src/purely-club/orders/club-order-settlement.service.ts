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
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
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
    paymentLockService: ClubPaymentLockService,
  ) {
    super(prisma, clubOrderDraftsService, cacheInvalidatorService, paymentLockService);
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

    // Club 端服务购买实际走微信支付（JSAPI），不扣余额
    // 积分抵扣部分在创建订单时已计算到 finalAmountFen 中
    const pointsDeductFen = draft.metadata.pointsDeductFen;
    const wechatPaidFen = draft.amountFen; // 用户实际通过微信支付的金额（已扣除积分抵扣）

    // recordConsumption、decrementProductStock、increasePromotionUsage 互不依赖，可并行
    await Promise.all([
      this.recordConsumption(
        tx,
        draft,
        settlementContext.customer.id,
        wechatPaidFen,
        pointsDeductFen,
      ),
      this.decrementProductStock(tx, draft),
      this.increasePromotionUsage(tx, draft),
    ]);

    // updateCustomerMetrics 和 deductCustomerPoints 操作同一行 marketingCustomer，需串行
    await this.updateCustomerMetrics(
      tx,
      settlementContext.customer.id,
      settlementContext.customer.totalSpent,
      draft.metadata.originalAmountFen,
    );
    // 若使用了积分抵扣，结算时从账户中扣除积分
    if (draft.metadata.pointsUsed > 0) {
      await this.deductCustomerPoints(
        tx,
        settlementContext.customer.id,
        draft.metadata.pointsUsed,
      );
    }
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
    const [customer, product] = await Promise.all([
      tx.marketingCustomer.findFirst({
        where: {
          id: draft.customerId ?? undefined,
          storeId: draft.storeId,
        },
        select: {
          id: true,
          totalSpent: true,
        },
      }),
      tx.marketingProduct.findFirst({
        where: {
          id: draft.metadata.productId,
          storeId: draft.storeId,
          isActive: true,
        },
        select: {
          id: true,
          stock: true,
        },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

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
    wechatPaidFen: number,
    pointsDeductFen: number,
  ): Promise<void> {
    await tx.marketingConsumption.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: draft.metadata.originalAmountFen,
        // Club 端服务购买走微信支付，余额支付为 0
        balancePaid: 0,
        pointsDeducted: pointsDeductFen,
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
    // 以原价金额作为累计消费的统计口径，与充值侧 totalSpent 对齐
    originalAmountFen: number,
  ): Promise<void> {
    const newTotalSpent = currentTotalSpent + originalAmountFen;
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        // Club 端服务购买走微信支付，不扣余额
        totalSpent: { increment: originalAmountFen },
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

  private async deductCustomerPoints(
    tx: Prisma.TransactionClient,
    customerId: number,
    pointsUsed: number,
  ): Promise<void> {
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        points: { decrement: pointsUsed },
      },
    });
  }
}
