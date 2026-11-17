// 充值 / 退款事务体：余额复核、条件更新与活动计数必须在同一事务内完成
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  MARKETING_RECHARGE_TYPE_VALUES,
  safeEnumCoerce,
  type MarketingRechargeTypeValue,
} from './marketing.utils';
import {
  queryCustomerGiftBalanceCents,
  queryCustomerRechargeRefundSums,
} from './marketing.query';
import type { CreateRechargeDto } from './dto/marketing-query.dto';

export interface CreateRechargeTransactionParams {
  tx: Prisma.TransactionClient;
  storeId: number;
  dto: CreateRechargeDto;
  /** 归一后的记录类型（dto.type 缺省为 recharge） */
  rechargeType: MarketingRechargeTypeValue;
  rechargeMoney: Money;
  giftMoney: Money;
  totalMoney: Money;
}

export interface CreateRechargeTransactionResult {
  rechargeId: number;
  /** 本次退款实际清零的赠送金额（分），0 表示未清零 */
  giftClearedAmountCents: number;
}

/**
 * 落库并更新余额：返回新记录 ID 与赠送清零金额（分），
 * 由调用方在提交成功后组装响应，失败时整笔回滚。
 */
export const createRechargeInTransaction = async (
  params: CreateRechargeTransactionParams,
): Promise<CreateRechargeTransactionResult> => {
  const {
    tx,
    storeId,
    dto,
    rechargeType,
    rechargeMoney,
    giftMoney,
    totalMoney,
  } = params;
  let giftClearedAmountCents = 0;

  // 事务内重新校验退款金额，防止并发退款导致超额退款
  let actualBalanceDeltaCents: number;
  let noteForDb: string | null = dto.note?.trim() || null;
  if (rechargeType === 'refund') {
    const freshCustomer = await tx.marketingCustomer.findUnique({
      where: { id: dto.customerId },
      select: { balance: true },
    });
    if (!freshCustomer) {
      throw new BadRequestException('顾客不存在');
    }
    // 事务内复核仍必须保留（防止并发超额退款），但只发一次聚合查询，
    // 缩短余额行锁的持有时间。
    const { rechargeCents, refundCents } =
      await queryCustomerRechargeRefundSums(tx, dto.customerId);
    const refundableCents = Math.max(0, rechargeCents - refundCents);
    if (Money.fromDbCents(refundableCents).lessThan(totalMoney)) {
      throw new BadRequestException('退款金额不能超过最大可退本金');
    }

    // 计算赠送金额余额：基于时间线遍历，退款清零 + 充值重新累计
    const giftBalanceCents = await queryCustomerGiftBalanceCents(
      tx,
      dto.customerId,
    );
    const clearGift = dto.clearRemainingGift === true;
    actualBalanceDeltaCents = clearGift
      ? -(totalMoney.toDbCents() + giftBalanceCents)
      : -totalMoney.toDbCents();

    // B1: 事务内余额兗底校验——实际扣减额不得超过当前余额
    if (
      Money.fromDbCents(freshCustomer.balance).lessThan(
        Money.fromDbCents(Math.abs(actualBalanceDeltaCents)),
      )
    ) {
      throw new BadRequestException(
        '退款金额（含赠送清零）不能超过顾客当前储值余额',
      );
    }

    // 在 note 中追加赠送清零金额（向后兼容），同时记录结构化字段
    if (clearGift && giftBalanceCents > 0) {
      giftClearedAmountCents = giftBalanceCents;
      const giftClearedYuan =
        Money.fromDbCents(giftBalanceCents).toOutputYuan();
      noteForDb = `${noteForDb ?? ''} | 赠送清零¥${giftClearedYuan}`;
    }
  } else {
    actualBalanceDeltaCents = totalMoney.toDbCents();
  }

  const recharge = await tx.marketingRecharge.create({
    data: {
      storeId,
      customerId: dto.customerId,
      amount: rechargeMoney.toDbCents(),
      // BUG-1: 退款记录存储实际清零的赠送金额，供读取算法使用
      giftAmount:
        rechargeType === 'refund'
          ? giftClearedAmountCents
          : giftMoney.toDbCents(),
      totalAmount: totalMoney.toDbCents(),
      // F7: 运行时枚举校验，避免脏值进入数据库
      type: safeEnumCoerce(
        rechargeType,
        MARKETING_RECHARGE_TYPE_VALUES,
        'recharge' as MarketingRechargeTypeValue,
      ),
      promotionId: dto.promotionId ?? null,
      note: noteForDb,
    },
  });

  // 并发守卫：上面的 freshCustomer.balance 校验在 Read Committed 下挡不住并发——
  // 两笔退款可以读到同一个余额并都通过校验。条件更新确保余额不会被扣成负数
  // （与消费路径 updateMany + balance gte 同口径）。
  const balanceUpdated = await tx.marketingCustomer.updateMany({
    where: {
      id: dto.customerId,
      ...(actualBalanceDeltaCents < 0
        ? { balance: { gte: Math.abs(actualBalanceDeltaCents) } }
        : {}),
    },
    data: { balance: { increment: actualBalanceDeltaCents } },
  });
  if (balanceUpdated.count === 0) {
    throw new BadRequestException(
      '退款金额（含赠送清零）超过顾客当前储值余额，请刷新后重试',
    );
  }

  if (dto.promotionId && rechargeType !== 'refund') {
    // 校验 promotionId 存在性且归属当前门店
    const promotion = await tx.marketingPromotion.findUnique({
      where: { id: dto.promotionId },
      select: { storeId: true },
    });
    if (!promotion || promotion.storeId !== storeId) {
      throw new BadRequestException('关联活动不存在或不属于当前门店');
    }
    await tx.marketingPromotion.updateMany({
      where: { id: dto.promotionId, storeId },
      data: {
        usageCount: { increment: 1 },
        totalDiscount: { increment: giftMoney.toDbCents() },
      },
    });
  }

  return { rechargeId: recharge.id, giftClearedAmountCents };
};
