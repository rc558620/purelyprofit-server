// 空间会话-会员卡预扣释放：从 space-session-card.shared.ts 拆出，控制单文件行数。
//
// 口径约定同 space-session-card.shared.ts：流水只追加，reserve 落 pending，
// 取消 / 失败补偿置 cancelled 并追加等额 release 流水，保证「次数变化 = 流水之和」。
import type { Prisma } from '@prisma/client';

/** 取消 / 失败补偿释放入参 */
export interface ReleaseMemberCardParams {
  sessionId: number;
  /** 限定卡范围（跨卡核对时使用）；不传则释放该会话全部预扣 */
  cardId?: number;
  remark?: string;
}

/** 释放结果：实际释放的预扣条数与回加次数 */
export interface MemberCardReleaseResult {
  releasedTransactions: number;
  restoredTimes: number;
}

/**
 * 取消 / 失败补偿：释放会话已预扣的次数。
 *
 * - 只处理 changeType=reserve 且 status=pending 的流水，天然幂等：
 *   `UPDATE ... RETURNING` 只返回本次真正改成 cancelled 的行，
 *   并发重复释放时另一事务拿到空集，与原「逐条 count===1」判断等价；
 * - 同一张卡的多条预扣合并为 1 次 increment，再在内存里回推每条流水的
 *   before/after（最终余次 → 逐条往前减），结果与逐条回加逐字段一致；
 * - release 流水用 createMany 一次落库，保证「次数变化 = 流水之和」。
 *
 * 说明：开台预扣与建台在同一事务内完成，开台失败由数据库回滚兜底，
 * 本函数服务于「开台成功后取消 / 结账前作废」这类跨事务场景。
 */
export async function releaseMemberCardReservation(
  tx: Prisma.TransactionClient,
  params: ReleaseMemberCardParams,
): Promise<MemberCardReleaseResult> {
  const remark = params.remark ?? '开台取消释放预扣';

  const cancelled = await tx.memberCardTransaction.updateManyAndReturn({
    where: {
      relatedSessionId: params.sessionId,
      changeType: 'reserve',
      status: 'pending',
      ...(params.cardId === undefined ? {} : { cardId: params.cardId }),
    },
    data: { status: 'cancelled', remark },
    select: {
      id: true,
      storeId: true,
      cardId: true,
      deltaTimes: true,
      relatedSpaceNameSnapshot: true,
    },
  });

  if (cancelled.length === 0) {
    return { releasedTransactions: 0, restoredTimes: 0 };
  }

  // 按卡汇总回加次数：同一张卡只发一次 increment
  const restoreByCard = new Map<number, number>();
  for (const reservation of cancelled) {
    const releaseTimes = Math.abs(reservation.deltaTimes);
    if (releaseTimes === 0) continue;
    restoreByCard.set(
      reservation.cardId,
      (restoreByCard.get(reservation.cardId) ?? 0) + releaseTimes,
    );
  }

  // 每张卡回加一次并拿到最终余次（卡不存在时保持 null，与原实现一致）
  const remainCursorByCard = new Map<number, number | null>();
  for (const [cardId, restoreTimes] of restoreByCard) {
    const restored = await tx.memberCard.updateManyAndReturn({
      where: { id: cardId },
      data: { remainTimes: { increment: restoreTimes } },
      select: { remainTimes: true },
    });
    remainCursorByCard.set(cardId, restored[0]?.remainTimes ?? null);
  }

  // 逆序回推：卡内最终余次已知，逐条往前减即得该条流水的 after / before
  const releaseRows: Prisma.MemberCardTransactionCreateManyInput[] = [];
  let restoredTimes = 0;
  for (let index = cancelled.length - 1; index >= 0; index -= 1) {
    const reservation = cancelled[index];
    const releaseTimes = Math.abs(reservation.deltaTimes);
    if (releaseTimes === 0) continue;

    const afterTimes = remainCursorByCard.get(reservation.cardId) ?? null;
    const beforeTimes = afterTimes === null ? null : afterTimes - releaseTimes;
    remainCursorByCard.set(reservation.cardId, beforeTimes);

    restoredTimes += releaseTimes;
    releaseRows.push({
      storeId: reservation.storeId,
      cardId: reservation.cardId,
      changeType: 'release',
      status: 'done',
      deltaTimes: releaseTimes,
      beforeTimes,
      afterTimes,
      relatedSessionId: params.sessionId,
      relatedSpaceNameSnapshot: reservation.relatedSpaceNameSnapshot,
      operatorType: 'cashier',
      remark,
    });
  }

  if (releaseRows.length > 0) {
    // 逆序构造后翻转，保持与原「按预扣顺序追加流水」一致的插入顺序
    await tx.memberCardTransaction.createMany({
      data: releaseRows.reverse(),
    });
  }

  return { releasedTransactions: cancelled.length, restoredTimes };
}
