import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
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
import {
  awardConsumptionPoints,
  deductCustomerPoints,
} from './club-order-settlement-points.utils';

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
    super(
      prisma,
      clubOrderDraftsService,
      cacheInvalidatorService,
      paymentLockService,
    );
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
    this.logger.log(
      `开始结算订单: orderNo=${draft.orderNo}, storeId=${draft.storeId}, customerId=${draft.customerId}`,
    );
    const settlementContext = await this.loadSettlementContext(tx, draft);
    this.logger.log(
      `加载结算上下文: customerId=${settlementContext.customer.id}, currentTotalSpent=${settlementContext.customer.totalSpent}, currentBalance=${settlementContext.customer.balance}`,
    );

    // 余额扣减金额 = 订单最终金额（已扣除积分抵扣部分）
    const balancePaidFen = draft.amountFen;
    const pointsDeductFen = draft.metadata.pointsDeductFen;

    // 校验余额是否充足
    if (settlementContext.customer.balance < balancePaidFen) {
      throw new BadRequestException(
        `余额不足，当前余额 ¥${Money.fromDbCents(settlementContext.customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
      );
    }

    // recordConsumption、decrementProductStock、increasePromotionUsage 互不依赖，可并行
    await Promise.all([
      this.recordConsumption(
        tx,
        draft,
        settlementContext.customer.id,
        balancePaidFen,
        pointsDeductFen,
      ),
      this.decrementProductStock(tx, draft),
      this.increasePromotionUsage(tx, draft),
    ]);

    // updateCustomerMetrics、deductCustomerPoints、awardConsumptionPoints 都操作同一行 marketingCustomer，需串行
    await this.updateCustomerMetrics(
      tx,
      settlementContext.customer.id,
      settlementContext.customer.totalSpent,
      balancePaidFen,
    );
    // 若使用了积分抵扣，结算时从账户中扣除
    if (draft.metadata.pointsUsed > 0) {
      await deductCustomerPoints(
        tx,
        draft,
        settlementContext.customer.id,
        draft.metadata.pointsUsed,
      );
    }
    // 根据消费金额和积分规则增加积分
    // 此操作也修改 marketingCustomer 的 points 字段，必须在 deductCustomerPoints 之后执行
    await awardConsumptionPoints(tx, draft, settlementContext.customer.id);
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
      balance: number;
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
          deletedAt: null,
        },
        select: {
          id: true,
          totalSpent: true,
          balance: true,
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
    balancePaidFen: number,
    pointsDeductFen: number,
  ): Promise<void> {
    await tx.marketingConsumption.create({
      data: {
        storeId: draft.storeId,
        customerId,
        // BUG-3 修复：amount 应包含积分抵扣部分，反映消费总金额
        amount: balancePaidFen + pointsDeductFen,
        balancePaid: balancePaidFen,
        pointsDeducted: pointsDeductFen,
        payType: 'balance',
        itemsSummary: draft.metadata.productName,
        promotionId: draft.metadata.promotionId,
      },
    });
  }

  private async updateCustomerMetrics(
    tx: Prisma.TransactionClient,
    customerId: number,
    currentTotalSpent: number,
    // 实际余额扣减金额
    balancePaidFen: number,
  ): Promise<void> {
    const newTotalSpent = currentTotalSpent + balancePaidFen;
    this.logger.log(
      `更新顾客指标: customerId=${customerId}, balancePaidFen=${balancePaidFen}, newTotalSpent=${newTotalSpent}`,
    );
    // 使用 updateMany + where 条件保证余额不会并发扣减为负数
    const result = await tx.marketingCustomer.updateMany({
      where: {
        id: customerId,
        // 防止并发扣减后余额为负：只有当前余额 >= 扣减金额时才执行
        balance: { gte: balancePaidFen },
      },
      data: {
        balance: { decrement: balancePaidFen },
        totalSpent: { increment: balancePaidFen },
        visitCount: { increment: 1 },
        lastVisitAt: new Date(),
        tier: calcCustomerTier(newTotalSpent) as never,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        `余额不足或已被并发消费，当前余额无法支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
      );
    }
    this.logger.log(`成功更新顾客指标`);
  }

  private async decrementProductStock(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): Promise<void> {
    // BUG-2 修复：根据购买数量扣减库存，而非硬编码 1
    const quantity = draft.metadata.quantity ?? 1;
    const result = await tx.marketingProduct.updateMany({
      where: {
        id: draft.metadata.productId,
        storeId: draft.storeId,
        stock: { gte: quantity },
      },
      data: {
        stock: { decrement: quantity },
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }
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
