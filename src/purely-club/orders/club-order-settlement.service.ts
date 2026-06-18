import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  calcCustomerTier,
  DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS,
} from '../../purely-profit/marketing/marketing.utils';
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
    console.log(
      `[persistPaidDraft] 开始结算订单: orderId=${draft.id}, orderNo=${draft.orderNo}, storeId=${draft.storeId}, customerId=${draft.customerId}`,
    );
    const settlementContext = await this.loadSettlementContext(tx, draft);
    console.log(
      `[persistPaidDraft] 加载结算上下文: customerId=${settlementContext.customer.id}, currentTotalSpent=${settlementContext.customer.totalSpent}, currentBalance=${settlementContext.customer.balance}`,
    );

    // 余额扣减金额 = 订单最终金额（已扣除积分抵扣部分）
    const balancePaidFen = draft.amountFen;
    const pointsDeductFen = draft.metadata.pointsDeductFen;

    // 校验余额是否充足
    if (settlementContext.customer.balance < balancePaidFen) {
      throw new BadRequestException(
        `余额不足，当前余额 ¥${(settlementContext.customer.balance / 100).toFixed(2)}，需支付 ¥${(balancePaidFen / 100).toFixed(2)}`,
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
    // 若使用了积分抵扣，结算时从账户中扣除积分
    if (draft.metadata.pointsUsed > 0) {
      await this.deductCustomerPoints(
        tx,
        settlementContext.customer.id,
        draft.metadata.pointsUsed,
      );
    }
    // 根据消费金额和积分规则增加积分
    // 此操作也修改 marketingCustomer 的 points 字段，必须在 deductCustomerPoints 之后执行
    await this.awardConsumptionPoints(tx, draft, settlementContext.customer.id);
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
        amount: balancePaidFen,
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
    console.log(
      `[updateCustomerMetrics] 更新顾客指标: customerId=${customerId}, balancePaidFen=${balancePaidFen}, newTotalSpent=${newTotalSpent}`,
    );
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        balance: { decrement: balancePaidFen },
        totalSpent: { increment: balancePaidFen },
        visitCount: { increment: 1 },
        lastVisitAt: new Date(),
        tier: calcCustomerTier(newTotalSpent) as never,
      },
    });
    console.log(`[updateCustomerMetrics] 成功更新顾客指标`);
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

  /**
   * 根据消费金额和积分规则增加积分
   * earnRatioCents 单位是"分"，表示消费多少分获得 1 积分
   * 前端通过 yuanStrToCents 将元转为分存储，例如消费 200 元得 1 积分 → earnRatioCents=20000
   * 积分 = floor(实际支付金额（分）/ earnRatioCents)
   */
  private async awardConsumptionPoints(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    customerId: number,
  ): Promise<void> {
    // 获取积分规则配置
    const pointsRatioConfig = await this.getPointsRatioConfig(
      tx,
      draft.storeId,
    );

    // 若积分规则未启用，不增加积分
    if (!pointsRatioConfig.enabled) {
      console.warn(
        `[awardConsumptionPoints] 积分规则未启用，storeId=${draft.storeId}`,
      );
      return;
    }

    // 按实际支付金额计算消费积分
    // earnRatioCents 单位是"分"，表示消费多少分获得 1 积分
    // 积分 = floor(实际支付金额（分）/ earnRatioCents)
    const earnedPoints = Math.floor(
      draft.amountFen / pointsRatioConfig.earnRatioCents,
    );

    console.log(
      `[awardConsumptionPoints] 计算积分: 实际支付=${draft.amountFen}分, earnRatioCents=${pointsRatioConfig.earnRatioCents}, 获得=${earnedPoints}积分`,
    );

    if (earnedPoints <= 0) {
      console.warn(
        `[awardConsumptionPoints] 计算的积分 <= 0，不增加，customerId=${customerId}`,
      );
      return;
    }

    // 增加顾客积分
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        points: { increment: earnedPoints },
      },
    });

    console.log(
      `[awardConsumptionPoints] 成功增加积分 ${earnedPoints}，customerId=${customerId}`,
    );

    // 记录积分增加流水
    try {
      await tx.marketingPointsRecord.create({
        data: {
          storeId: draft.storeId,
          customerId,
          amount: earnedPoints,
          type: 'earn' as const,
          description: '消费获得积分',
        },
      });
    } catch (error) {
      // 积分流水记录失败不应阻止订单落账
      console.error('Failed to create points record:', error);
    }
  }

  /**
   * 获取积分规则配置
   * 从 marketingMemberLevelSetting 中读取，若未配置则使用默认值
   */
  private async getPointsRatioConfig(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<{ earnRatioCents: number; enabled: boolean }> {
    const settings = await tx.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: { pointsRatio: true },
    });

    // 若未配置，使用默认值
    if (
      !settings?.pointsRatio ||
      typeof settings.pointsRatio !== 'object' ||
      Array.isArray(settings.pointsRatio)
    ) {
      return {
        earnRatioCents:
          DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.earnRatioCents,
        enabled: DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.enabled,
      };
    }

    const pointsRatioData = settings.pointsRatio as Record<string, unknown>;
    return {
      earnRatioCents:
        typeof pointsRatioData.earnRatioCents === 'number' &&
        pointsRatioData.earnRatioCents > 0
          ? pointsRatioData.earnRatioCents
          : DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.earnRatioCents,
      enabled:
        typeof pointsRatioData.enabled === 'boolean'
          ? pointsRatioData.enabled
          : DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.enabled,
    };
  }
}
