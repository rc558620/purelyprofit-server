// 空间会话-结账侧会员卡核销：
//  - 卡可用性复核（只读）：归属 / 状态 / 有效期 / 次数，口径与开台侧保持一致；
//  - 次数卡「确认扣次」：开台已预扣（reserve pending）→ 条件更新置 done（幂等）；
//  - 结账当场选卡（开台未绑卡）→ 一次原子扣次 + consume 流水，避免次数卡被当作无限折扣。
//
// 恒等式约束（见 prisma/purely-profit/member/cards.prisma）：
//   usedTimes + remainTimes + 预扣中次数 = totalTimes
// 因此「确认」只递增 usedTimes，绝不重复扣 remainTimes；只有「当场选卡」才扣 remainTimes。
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  MEMBER_CARD_STATUS_REASONS,
  resolvePerUseTimes,
} from './space-session-card.shared';

/** 结账侧持卡快照（只读校验结果，驱动扣次与卡抵扣行） */
export interface CheckoutMemberCardSnapshot {
  cardId: number;
  cardNo: string;
  /** 卡类型：times 需扣次，时长卡只抵台位费 */
  kind: string;
  /** 本次应扣次数（时长卡为 0） */
  perUseTimes: number;
  /** 开台已预扣且流水仍为 pending：结账只需确认，不再扣次 */
  hasPendingReserve: boolean;
}

export interface ResolveCheckoutMemberCardParams {
  /** 会话所属门店：卡必须属于同一门店 */
  storeId: number;
  /** 会话识别的营销顾客；null 表示未识别会员，禁止用卡抵扣 */
  customerId: number | null;
  /** 开台绑定的持卡实例（SpaceSession.activeCardId） */
  activeCardId: number | null;
  /** 结账显式选择的持卡实例（settlements 中 member_card.assetId） */
  selectedCardId: number | null;
  /** 会话 ID：探测开台预扣是否仍为 pending */
  sessionId: number;
  /** 校验基准时间，默认当前时间 */
  now?: Date;
}

export interface ApplyCheckoutMemberCardParams {
  storeId: number;
  sessionId: number;
  /** 本次结账生成的销售单号：写入流水 relatedSaleOrderNo，便于对账 */
  saleOrderNo: string;
  /** 台位名称快照（台位改名后历史流水语义不漂移） */
  spaceNameSnapshot: string;
  snapshot: CheckoutMemberCardSnapshot;
  operatorStaffId?: number | null;
  operatorNameSnapshot?: string | null;
}

/** 探测该场次在该卡上是否仍有 pending 的预扣流水（开台预扣未确认过） */
const hasPendingReserveTimes = async (
  tx: Prisma.TransactionClient,
  sessionId: number,
  cardId: number,
): Promise<boolean> => {
  const pending = await tx.memberCardTransaction.findFirst({
    where: {
      relatedSessionId: sessionId,
      cardId,
      changeType: 'reserve',
      status: 'pending',
    },
    select: { id: true },
  });
  return pending !== null;
};

/**
 * 结账前复核会员卡（只读）。
 *
 * 与开台侧 assertMemberCardUsable 的差异：结账不再校验星期 / 人数 / 空间类型
 * （这些限制在开台时已通过，结账时间点可能已跨天），只复核「卡还能不能用」。
 * 未选择也未绑定卡时返回 null（无卡抵扣路径）。
 */
export async function resolveCheckoutMemberCard(
  tx: Prisma.TransactionClient,
  params: ResolveCheckoutMemberCardParams,
): Promise<CheckoutMemberCardSnapshot | null> {
  // 兜底 ?? null：部分调用方（历史测试替身 / 局部 select）可能读不到该字段
  const cardId = params.selectedCardId ?? params.activeCardId ?? null;
  if (cardId === null) {
    return null;
  }
  if (
    params.selectedCardId !== null &&
    params.activeCardId !== null &&
    params.selectedCardId !== params.activeCardId
  ) {
    throw new BadRequestException(
      '当前场次已绑定其他会员卡，请先取消开台卡绑定后再更换',
    );
  }
  if (params.customerId === null) {
    throw new BadRequestException('该场次未识别会员，无法使用会员卡抵扣');
  }

  const card = await tx.memberCard.findFirst({
    where: { id: cardId },
    select: {
      id: true,
      storeId: true,
      customerId: true,
      cardNo: true,
      kind: true,
      status: true,
      startsAt: true,
      expiresAt: true,
      remainTimes: true,
      plan: { select: { perUseTimes: true } },
    },
  });
  if (!card || card.storeId !== params.storeId) {
    throw new NotFoundException('会员卡不存在');
  }
  if (card.customerId !== params.customerId) {
    throw new BadRequestException('该会员卡不属于当前会员，请重新识别会员');
  }
  if (card.status !== 'active') {
    throw new BadRequestException(
      MEMBER_CARD_STATUS_REASONS[card.status] ?? '该会员卡当前不可用',
    );
  }

  const now = params.now ?? new Date();
  if (card.startsAt > now) {
    throw new BadRequestException('该会员卡尚未生效');
  }
  if (card.expiresAt !== null && card.expiresAt <= now) {
    throw new BadRequestException(MEMBER_CARD_STATUS_REASONS.expired);
  }

  if (card.kind !== 'times') {
    return {
      cardId: card.id,
      cardNo: card.cardNo,
      kind: card.kind,
      perUseTimes: 0,
      hasPendingReserve: false,
    };
  }

  const perUseTimes = resolvePerUseTimes(card.plan.perUseTimes);
  const hasPendingReserve = await hasPendingReserveTimes(
    tx,
    params.sessionId,
    card.id,
  );
  const remainTimes = card.remainTimes ?? 0;
  // 已有预扣时 remainTimes 已被扣过一次，此处不能再要求「剩余 >= 本次次数」
  if (!hasPendingReserve && remainTimes < perUseTimes) {
    throw new ConflictException(
      `该会员卡剩余次数不足（剩余 ${remainTimes} 次，本次需 ${perUseTimes} 次）`,
    );
  }

  return {
    cardId: card.id,
    cardNo: card.cardNo,
    kind: card.kind,
    perUseTimes,
    hasPendingReserve,
  };
}

/**
 * 确认开台预扣（reserve → done，幂等）。
 *
 * 条件更新只命中 pending 行：结账重试 / 并发二次确认时命中 0 行，
 * 不会重复递增 usedTimes，也不会改 already-done 流水的销售单号。
 */
const confirmMemberCardReservation = async (
  tx: Prisma.TransactionClient,
  params: ApplyCheckoutMemberCardParams,
): Promise<void> => {
  const flipped = await tx.memberCardTransaction.updateManyAndReturn({
    where: {
      relatedSessionId: params.sessionId,
      cardId: params.snapshot.cardId,
      changeType: 'reserve',
      status: 'pending',
    },
    data: { status: 'done', relatedSaleOrderNo: params.saleOrderNo },
    select: { deltaTimes: true },
  });
  const confirmedTimes = flipped.reduce(
    (sum, row) => sum + Math.abs(row.deltaTimes),
    0,
  );
  if (confirmedTimes <= 0) {
    return;
  }

  await tx.memberCard.updateMany({
    where: { id: params.snapshot.cardId },
    data: { usedTimes: { increment: confirmedTimes } },
  });
};

/**
 * 结账当场扣次（开台未预扣的场景：收银在结账弹窗临时选择次数卡）。
 *
 * remainTimes 走条件更新（remainTimes >= n 且 active），命中 0 行说明并发已扣完，
 * 整笔结账事务回滚，避免超扣；流水与计数在同一事务内，保证「次数变化 = 流水之和」。
 */
const consumeMemberCardTimesAtCheckout = async (
  tx: Prisma.TransactionClient,
  params: ApplyCheckoutMemberCardParams,
): Promise<void> => {
  const perUseTimes = params.snapshot.perUseTimes;
  const updated = await tx.memberCard.updateManyAndReturn({
    where: {
      id: params.snapshot.cardId,
      storeId: params.storeId,
      status: 'active',
      remainTimes: { gte: perUseTimes },
    },
    data: {
      remainTimes: { decrement: perUseTimes },
      usedTimes: { increment: perUseTimes },
    },
    select: { remainTimes: true },
  });
  if (updated.length !== 1) {
    throw new ConflictException('该会员卡剩余次数不足，请重新选择会员卡');
  }

  const afterTimes = updated[0].remainTimes;
  const beforeTimes = afterTimes === null ? null : afterTimes + perUseTimes;

  await tx.memberCardTransaction.create({
    data: {
      storeId: params.storeId,
      cardId: params.snapshot.cardId,
      changeType: 'consume',
      status: 'done',
      deltaTimes: -perUseTimes,
      beforeTimes,
      afterTimes,
      relatedSessionId: params.sessionId,
      relatedSpaceNameSnapshot: params.spaceNameSnapshot,
      relatedSaleOrderNo: params.saleOrderNo,
      operatorType: 'cashier',
      operatorStaffId: params.operatorStaffId ?? null,
      operatorName: params.operatorNameSnapshot ?? null,
      remark: '空间结账核销次数',
    },
    select: { id: true },
  });
};

/**
 * 应用会员卡核销：时长卡不扣次（只有金额抵扣），次数卡按「确认预扣 / 当场扣次」分流。
 */
export async function applyCheckoutMemberCard(
  tx: Prisma.TransactionClient,
  params: ApplyCheckoutMemberCardParams,
): Promise<void> {
  if (params.snapshot.perUseTimes <= 0) {
    return;
  }
  if (params.snapshot.hasPendingReserve) {
    await confirmMemberCardReservation(tx, params);
    return;
  }
  await consumeMemberCardTimesAtCheckout(tx, params);
}
