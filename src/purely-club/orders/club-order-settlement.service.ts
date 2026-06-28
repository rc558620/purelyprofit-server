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
import type { ClubPointsEarnConfig } from './club-order-drafts.utils';
import { resolvePointsEarnConfig } from './club-order-drafts.utils';
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
    // 若使用了积分抵扣，结算时从账户中扣除积分
    if (draft.metadata.pointsUsed > 0) {
      await this.deductCustomerPoints(
        tx,
        draft,
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
    // 使用 where 条件 stock > 0 防止并发下单导致库存为负
    const result = await tx.marketingProduct.updateMany({
      where: {
        id: draft.metadata.productId,
        storeId: draft.storeId,
        stock: { gt: 0 },
      },
      data: {
        stock: { decrement: 1 },
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

  private async deductCustomerPoints(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    customerId: number,
    pointsUsed: number,
  ): Promise<void> {
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        points: { decrement: pointsUsed },
      },
    });

    // 记录积分扣减流水，与 awardConsumptionPoints 中的 earn 流水保持一致
    await tx.marketingPointsRecord.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: -pointsUsed,
        type: 'spend' as const,
        description: `消费抵扣积分（${draft.metadata.productName}）`,
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
      this.logger.warn(`积分规则未启用，storeId=${draft.storeId}`);
      return;
    }

    // 按实际支付金额计算消费积分
    // earnRatioCents 单位是"分"，表示消费多少分获得 1 积分
    // 积分 = floor(实际支付金额（分）/ earnRatioCents)
    let earnedPoints = Math.floor(
      draft.amountFen / pointsRatioConfig.earnRatioCents,
    );

    // 查询是否有生效的 points_2x（双倍积分）活动，若有则将积分翻倍
    const pointsMultiplier = await this.resolvePointsMultiplier(
      tx,
      draft.storeId,
    );
    if (pointsMultiplier > 1 && earnedPoints > 0) {
      const bonusPoints = earnedPoints * (pointsMultiplier - 1);
      earnedPoints += bonusPoints;
      this.logger.log(
        `双倍积分活动生效: 基础积分=${earnedPoints - bonusPoints}, 加倍=${bonusPoints}, 合计=${earnedPoints}`,
      );
    }

    this.logger.log(
      `计算积分: 实际支付=${draft.amountFen}分, earnRatioCents=${pointsRatioConfig.earnRatioCents}, 获得=${earnedPoints}积分`,
    );

    if (earnedPoints <= 0) {
      this.logger.warn(`计算的积分 <= 0，不增加，customerId=${customerId}`);
      return;
    }

    // 增加顾客积分
    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: {
        points: { increment: earnedPoints },
      },
    });

    this.logger.log(`成功增加积分 ${earnedPoints}，customerId=${customerId}`);

    // 记录积分增加流水（与 deductCustomerPoints 中 spend 流水保持一致）
    // 在同一事务内：若 create 失败则整体回滚，保证积分余额与流水记录一致
    await tx.marketingPointsRecord.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: earnedPoints,
        type: 'earn' as const,
        description:
          pointsMultiplier > 1
            ? '消费获得积分（含双倍积分加成）'
            : '消费获得积分',
      },
    });
  }

  /**
   * 查询门店是否有生效的 points_2x 活动，返回积分倍数（2 或 1）
   */
  private async resolvePointsMultiplier(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<number> {
    const now = new Date();
    const activePoints2x = await tx.marketingPromotion.findFirst({
      where: {
        storeId,
        type: 'points_2x',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { id: true },
    });

    return activePoints2x ? 2 : 1;
  }

  /**
   * 获取积分获得配置
   * 从 marketingMemberLevelSetting 中读取，若未配置则使用默认值
   */
  private async getPointsRatioConfig(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<ClubPointsEarnConfig> {
    const settings = await tx.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: { pointsRatio: true },
    });

    return resolvePointsEarnConfig(settings?.pointsRatio);
  }
}
