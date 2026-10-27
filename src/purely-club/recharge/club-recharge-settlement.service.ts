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
  ClubOrderPaidObservationOptions,
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
import { ClubRechargeOrderStoreService } from './club-recharge-order-store.service';

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
    private readonly clubRechargeOrderStoreService: ClubRechargeOrderStoreService,
  ) {
    super(
      prisma,
      clubOrderDraftsService,
      cacheInvalidatorService,
      paymentLockService,
    );
  }

  /**
   * 落账入口：在交给基类前先完成两件事。
   *
   * 1. 迟到回调补偿：订单超时被标记为 expired 后，用户仍可能在微信侧完成支付
   *    （微信支付有效期与本地订单有效期不一致）。真实回调到达时必须继续落账，
   *    否则会出现「钱已扣、余额不到账」。手动确认（开发态）不享受该豁免。
   * 2. 把支付观测信息（流水号 / 回调时间 / 确认来源）合并进草稿，
   *    使事务内的落账逻辑能读到权威的支付事实，不必依赖 Redis 后续回写。
   */
  async completePaidDraft(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): Promise<ClubRechargeOrderResponseDto> {
    return super.completePaidDraft(
      this.withPaymentObservation(draft, paymentMeta),
      paymentMeta,
    );
  }

  private withPaymentObservation(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'> {
    const confirmationSource =
      paymentMeta?.paymentConfirmationSource ?? draft.paymentConfirmationSource;

    const isLateWechatCallback =
      confirmationSource === 'wechat_callback' && draft.status === 'expired';

    return {
      ...draft,
      status: isLateWechatCallback ? 'pending' : draft.status,
      failureReason: isLateWechatCallback ? null : draft.failureReason,
      paidAtMs: draft.paidAtMs ?? paymentMeta?.paidAtMs ?? null,
      paymentTransactionId:
        draft.paymentTransactionId ?? paymentMeta?.paymentTransactionId ?? null,
      callbackReceivedAtMs:
        draft.callbackReceivedAtMs ?? paymentMeta?.callbackReceivedAtMs ?? null,
      paymentConfirmationSource: confirmationSource,
    };
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
    // 幂等闸门：订单表是充值落账的事实源。抢占失败说明该订单此前已落账，
    // 必须整体跳过余额与流水写入，否则重复回调会重复加余额。
    const claimed = await this.clubRechargeOrderStoreService.claimPaid(
      tx,
      draft,
      {
        paidAtMs: draft.paidAtMs ?? undefined,
        paymentTransactionId: draft.paymentTransactionId,
        callbackReceivedAtMs: draft.callbackReceivedAtMs,
        paymentConfirmationSource: draft.paymentConfirmationSource,
      },
    );

    if (!claimed) {
      this.logger.warn(`充值订单 ${draft.orderNo} 已落账，跳过本次重复落账`);
      return;
    }

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
    // 顾客档案必须显式绑定。若把 null 转成 undefined 再传进 where，Prisma 会忽略
    // id 条件，查询退化成「按门店取任意顾客」，把充值记到别人头上。
    if (draft.customerId === null) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    const customer = await tx.marketingCustomer.findFirst({
      where: {
        id: draft.customerId,
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
        // 订单号与微信流水号落库：既是重复落账的数据库兜底键，也是对账依据
        orderNo: draft.orderNo,
        transactionId: draft.paymentTransactionId,
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
    //
    // ⚠️ created_at 必须显式写 `NOW() AT TIME ZONE 'UTC'`：
    // 该列是 TIMESTAMP WITHOUT TIME ZONE，缺省值 CURRENT_TIMESTAMP 取数据库会话时区
    // （部署环境 Asia/Shanghai）的墙钟，而 Prisma/驱动按 UTC 解释 naive 值，
    // 会导致流水时间比实际快 8 小时（C 端积分记录页显示错乱）。
    await tx.$executeRaw`
      INSERT INTO marketing_points_records (
        store_id,
        customer_id,
        amount,
        type,
        description,
        created_at
      )
      VALUES (
        ${draft.storeId},
        ${customerId},
        ${earnedPoints},
        ${'gift'}::"MarketingPointsChangeType",
        ${`充值赠送积分（${pointsPromotion.name}）`},
        NOW() AT TIME ZONE 'UTC'
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
