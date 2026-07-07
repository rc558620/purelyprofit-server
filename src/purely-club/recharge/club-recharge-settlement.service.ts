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
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import {
  CLUB_MEMBER_NOT_FOUND_MESSAGE,
  CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE,
} from './club-recharge.constants';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';

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
      throw new BadRequestException(CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE);
    }
  }

  protected async persistPaidDraft(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<void> {
    const customer = await this.findCustomer(tx, draft);
    await this.createRechargeRecord(tx, draft, customer.id);
    await this.updateCustomerAfterRecharge(tx, draft, customer);
    await this.awardRechargePoints(tx, draft, customer.id);
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
        deletedAt: null,
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
    // 防御性校验：充值金额必须为正，赠送金额不可为负
    if (draft.metadata.rechargeAmountFen <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }
    if (draft.metadata.bonusAmountFen < 0) {
      throw new BadRequestException('赠送金额不可为负数');
    }

    return tx.marketingRecharge.create({
      data: {
        storeId: draft.storeId,
        customerId,
        amount: draft.metadata.rechargeAmountFen,
        giftAmount: Math.max(0, draft.metadata.bonusAmountFen),
        totalAmount: Money.fromDbCents(draft.metadata.rechargeAmountFen)
          .add(Money.fromDbCents(Math.max(0, draft.metadata.bonusAmountFen)))
          .toDbCents(),
        type: 'recharge',
        promotionId: draft.metadata.promotionId,
        note: `club充值订单 ${draft.orderNo}`,
      },
    });
  }

  /**
   * 充值落账后更新顾客储值余额。
   * 注意：充值金额不计入 totalSpent（累计消费），tier 仅在消费时重算。
   */
  private updateCustomerAfterRecharge(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    customer: { id: number },
  ): Promise<unknown> {
    const totalCreditFen =
      draft.metadata.rechargeAmountFen + draft.metadata.bonusAmountFen;

    return tx.marketingCustomer.update({
      where: { id: customer.id },
      data: {
        balance: { increment: totalCreditFen },
      },
    });
  }

  /**
   * 查找门店当前有效的 points_recharge 活动，按充值金额计算赠送积分并落账。
   * rechargeRatioPercent = 2 表示充 ¥100 赠 2 积分。
   */
  private async awardRechargePoints(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    customerId: number,
  ): Promise<void> {
    const now = new Date();
    const pointsPromotion = await tx.marketingPromotion.findFirst({
      where: {
        storeId: draft.storeId,
        type: 'points_recharge',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { id: true, params: true, name: true },
    });

    if (!pointsPromotion) {
      return;
    }

    const params =
      pointsPromotion.params && typeof pointsPromotion.params === 'object'
        ? (pointsPromotion.params as Record<string, unknown>)
        : {};

    const ratioPercent =
      typeof params.rechargeRatioPercent === 'number'
        ? params.rechargeRatioPercent
        : typeof params.pointsRatio === 'number'
          ? params.pointsRatio
          : null;

    if (ratioPercent === null || ratioPercent <= 0) {
      return;
    }

    // 充值金额（分）→ 元，再按比例计算积分
    const rechargeYuan = new Decimal(draft.metadata.rechargeAmountFen).div(100);
    const earnedPoints = rechargeYuan
      .mul(ratioPercent)
      .div(100)
      .toDecimalPlaces(0)
      .toNumber();

    if (earnedPoints <= 0) {
      return;
    }

    await tx.marketingCustomer.update({
      where: { id: customerId },
      data: { points: { increment: earnedPoints } },
    });

    // 写入积分记录。
    // 执行计划说明：
    // - INSERT 单行，无复杂查询，性能无风险
    // - marketing_points_records 无唯一约束冲突风险（每次 INSERT 新行）
    await tx.$executeRaw`
      INSERT INTO marketing_points_records (
        store_id,
        customer_id,
        amount,
        type,
        description
      )
      VALUES (
        ${draft.storeId},
        ${customerId},
        ${earnedPoints},
        ${'gift'}::"MarketingPointsChangeType",
        ${`充值赠送积分（${pointsPromotion.name}）`}
      )
    `;
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
        totalDiscount: { increment: draft.metadata.bonusAmountFen },
      },
    });
  }
}
