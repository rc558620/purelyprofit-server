// 手动增减次数事务：条件更新（防超扣 / 防并发覆盖）→ 状态校正 → 写 adjust 流水
//
// 并发口径：所有次数变更都走带条件的 updateMany，用影响行数裁决，
// 禁止「先读 remainTimes 再写回」的裸 read-modify-write。
import { ConflictException } from '@nestjs/common';
import type { MemberCard, Prisma } from '@prisma/client';
import {
  MEMBER_CARD_ADJUSTABLE_STATUS_VALUES,
  type MemberCardStatusValue,
} from './member-card.constants';

/** 一次手动调次的落库上下文（卡片快照已在事务外用权限校验读取） */
export interface AdjustTimesWriteContext {
  card: MemberCard;
  /** 正数增加、负数减少，且保证不为 0 */
  delta: number;
  remark: string;
  operatorStaffId: number | null;
  operatorName: string | null;
}

/**
 * 调整后的持卡状态：
 * - 剩余次数归零 → exhausted（次数用尽）；
 * - 用尽后又加回次数 → 恢复 active；
 * - 其余状态保持原值（frozen / refunded 不会走到这里，已被条件更新拦下）。
 */
function resolveStatusAfterAdjust(
  remainTimes: number,
  current: MemberCardStatusValue,
): MemberCardStatusValue {
  if (remainTimes <= 0) {
    return 'exhausted';
  }
  if (current === 'exhausted') {
    return 'active';
  }
  return current;
}

/**
 * 执行手动调次。返回调整后的剩余次数。
 *
 * 减次数时条件里带 remainTimes >= |delta|：并发两次扣减只会有一次成功，
 * 另一次因影响行数为 0 而抛冲突，由调用方提示刷新重试。
 */
export async function applyTimesAdjustment(
  tx: Prisma.TransactionClient,
  context: AdjustTimesWriteContext,
): Promise<number> {
  const { card, delta } = context;

  const updated = await tx.memberCard.updateMany({
    where: {
      id: card.id,
      storeId: card.storeId,
      status: { in: [...MEMBER_CARD_ADJUSTABLE_STATUS_VALUES] },
      // 次数卡的 remainTimes 必须有值；减次数时要求余额足够
      remainTimes: delta < 0 ? { gte: -delta } : { not: null },
    },
    data: {
      // totalTimes 与 remainTimes 同步增减，维持 usedTimes + remainTimes = totalTimes
      remainTimes: { increment: delta },
      totalTimes: { increment: delta },
    },
  });

  if (updated.count === 0) {
    throw new ConflictException('会员卡状态已变更或剩余次数不足，请刷新后重试');
  }

  const after = await tx.memberCard.findUniqueOrThrow({
    where: { id: card.id },
    select: { remainTimes: true, totalTimes: true, status: true },
  });
  const afterTimes = after.remainTimes ?? 0;
  const nextStatus = resolveStatusAfterAdjust(afterTimes, after.status);

  if (nextStatus !== after.status) {
    await tx.memberCard.update({
      where: { id: card.id },
      data: { status: nextStatus },
    });
  }

  await tx.memberCardTransaction.create({
    data: {
      storeId: card.storeId,
      cardId: card.id,
      changeType: 'adjust',
      status: 'done',
      deltaTimes: delta,
      beforeTimes: afterTimes - delta,
      afterTimes,
      operatorType: 'cashier',
      operatorStaffId: context.operatorStaffId,
      operatorName: context.operatorName,
      remark: context.remark,
    },
  });

  return afterTimes;
}
