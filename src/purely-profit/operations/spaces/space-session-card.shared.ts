// 空间会话-会员卡共享逻辑：开台卡可用性校验、次数原子预扣（reserve 流水）、取消/失败释放。
//
// 口径约定（与 prisma/purely-profit/member/cards.prisma、be-06 结账链路对齐）：
// - 次数卡的剩余次数冗余在 remain_times：预扣只允许走带条件的 updateMany
//   （where remainTimes >= n），禁止 read-modify-write，避免并发超扣；
// - 恒等式：usedTimes + remainTimes + 预扣中（pending reserve）次数 = totalTimes，
//   因此预扣只减 remainTimes，usedTimes 由结账确认（reserve → done）时递增；
// - 流水只追加：reserve 落 pending，结账确认置 done，取消 / 失败补偿置 cancelled
//   并追加一条等额 release 流水，保证审计链不断裂；
// - 时长卡（monthly / quarterly / yearly）不扣次，仅作为开台凭证落
//   SpaceSession.activeCardId，结账侧据此判定台位费抵扣。
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** 开台会员卡校验入参 */
export interface MemberCardOpenCheckParams {
  storeId: number;
  /** 开台识别到的营销顾客（SpaceSession.customerId） */
  customerId: number;
  /** 本次开台核销的持卡实例（SpaceSession.activeCardId） */
  cardId: number;
  /** 当前空间类型 ID（usableSpaceTypes 兼容按 ID 配置） */
  spaceTypeId: number;
  /** 当前空间类型名称（usableSpaceTypes 兼容按名称配置，历史模板均按名称录入） */
  spaceTypeName: string;
  /** 本次开台人数：仅用于 maxGuestPerUse 校验，未填则不校验 */
  guestCount?: number;
  /** 校验基准时间，默认取当前时间 */
  now?: Date;
}

/** 校验通过后的持卡快照（供预扣与后续结账复用） */
export interface UsableMemberCardSnapshot {
  cardId: number;
  cardNo: string;
  /** 卡类型快照：times 需扣次，其余时长卡不扣次 */
  kind: string;
  /** 本次应预扣次数（时长卡为 0） */
  perUseTimes: number;
}

/** 事务内预扣入参 */
export interface ReserveMemberCardParams {
  snapshot: UsableMemberCardSnapshot;
  sessionId: number;
  /** 会话所属门店（与卡归属门店一致，冗余校验防跨店核销） */
  storeId: number;
  /** 台位名称快照（台位改名后历史流水语义不漂移） */
  spaceNameSnapshot: string;
  operatorStaffId?: number | null;
  operatorNameSnapshot?: string | null;
}

/** 事务内预扣结果 */
export interface MemberCardReserveResult {
  reserved: boolean;
  perUseTimes: number;
  beforeTimes: number | null;
  afterTimes: number | null;
  transactionId?: number;
}

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
 * 卡状态 → 可直接展示的中文拦截原因（避免前端自拼枚举文案）。
 * 结账侧（space-session-checkout-card.shared）复用同一份文案，防止开台/结账两处漂移。
 */
export const MEMBER_CARD_STATUS_REASONS: Record<string, string> = {
  expired: '该会员卡已过期',
  exhausted: '该会员卡次数已用尽',
  frozen: '该会员卡已冻结，无法使用',
  refunded: '该会员卡已退款，无法使用',
};

/** ISO 星期（周一=1 … 周日=7），与 card plan 的 usableWeekdays 口径一致 */
const resolveIsoWeekday = (date: Date): number => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

/**
 * 单次扣减次数兜底：历史数据 0 / null 一律按 1 次处理，避免开台扣 0 次。
 * 结账侧同口径复用（卡抵扣金额与扣次必须基于同一个 perUseTimes）。
 */
export const resolvePerUseTimes = (perUseTimes: number | null): number =>
  perUseTimes !== null && Number.isInteger(perUseTimes) && perUseTimes > 0
    ? perUseTimes
    : 1;

/** 星期限制校验：空数组表示不限 */
const assertWeekdayAllowed = (usableWeekdays: number[], now: Date): void => {
  if (usableWeekdays.length === 0) {
    return;
  }
  if (!usableWeekdays.includes(resolveIsoWeekday(now))) {
    throw new BadRequestException('该会员卡今日不可用（卡模板限定了可用星期）');
  }
};

/** 人数限制校验：maxGuestPerUse 为 null 表示不限 */
const assertGuestCountAllowed = (
  maxGuestPerUse: number | null,
  guestCount: number | undefined,
): void => {
  if (maxGuestPerUse === null || guestCount === undefined) {
    return;
  }
  if (guestCount > maxGuestPerUse) {
    throw new BadRequestException(
      `该会员卡单次最多 ${maxGuestPerUse} 人使用，当前 ${guestCount} 人`,
    );
  }
};

/**
 * 空间类型限制校验：usableSpaceTypes 为空表示不限。
 *
 * 模板侧入参为「空间类型编码」，但 space_types 表当前只有 id 与 name 两列（无编码列），
 * 因此兼容两种历史写法：类型 ID 字符串、类型名称（大小写不敏感）。
 */
const assertSpaceTypeAllowed = (
  usableSpaceTypes: string[],
  spaceTypeId: number,
  spaceTypeName: string,
): void => {
  const configured = usableSpaceTypes
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (configured.length === 0) {
    return;
  }
  const allowed = new Set<string>([
    String(spaceTypeId),
    spaceTypeName.trim().toLowerCase(),
  ]);
  if (!configured.some((value) => allowed.has(value.toLowerCase()))) {
    throw new BadRequestException('该会员卡不适用于当前空间类型');
  }
};

/**
 * 校验会员卡能否用于本次开台（只读，不产生任何写入）。
 *
 * 校验顺序：归属 → 状态 → 有效期 → 模板限制（星期 / 人数 / 空间类型）→ 剩余次数，
 * 顺序保证报错文案命中最小必要信息，不会把「卡不属于该顾客」误报成「次数不足」。
 */
export async function assertMemberCardUsable(
  tx: Prisma.TransactionClient,
  params: MemberCardOpenCheckParams,
): Promise<UsableMemberCardSnapshot> {
  const card = await tx.memberCard.findFirst({
    where: { id: params.cardId },
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
      plan: {
        select: {
          perUseTimes: true,
          usableSpaceTypes: true,
          usableWeekdays: true,
          maxGuestPerUse: true,
        },
      },
    },
  });

  if (!card || card.storeId !== params.storeId) {
    throw new NotFoundException('会员卡不存在');
  }
  if (card.customerId !== params.customerId) {
    throw new BadRequestException('该会员卡不属于当前顾客，请重新识别会员');
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

  assertWeekdayAllowed(card.plan.usableWeekdays, now);
  assertGuestCountAllowed(card.plan.maxGuestPerUse, params.guestCount);
  assertSpaceTypeAllowed(
    card.plan.usableSpaceTypes,
    params.spaceTypeId,
    params.spaceTypeName,
  );

  if (card.kind !== 'times') {
    return {
      cardId: card.id,
      cardNo: card.cardNo,
      kind: card.kind,
      perUseTimes: 0,
    };
  }

  const perUseTimes = resolvePerUseTimes(card.plan.perUseTimes);
  const remainTimes = card.remainTimes ?? 0;
  if (remainTimes < perUseTimes) {
    throw new ConflictException(
      `该会员卡剩余次数不足（剩余 ${remainTimes} 次，本次需 ${perUseTimes} 次）`,
    );
  }

  return { cardId: card.id, cardNo: card.cardNo, kind: card.kind, perUseTimes };
}

/**
 * 事务内原子预扣次数并写 reserve 流水。
 *
 * - 时长卡（perUseTimes = 0）：不扣次、不写流水，仅由调用方落 activeCardId；
 * - 次数卡：updateMany 条件更新（remainTimes >= n 且状态 active），
 *   命中 0 行说明并发已抢占或次数被他人扣完 → 抛冲突，整笔开台事务回滚；
 * - 写流水前以「本次更新后的值」反推变更前值，避免预读快照在并发下漂移。
 */
export async function reserveMemberCardTimes(
  tx: Prisma.TransactionClient,
  params: ReserveMemberCardParams,
): Promise<MemberCardReserveResult> {
  const perUseTimes = params.snapshot.perUseTimes;
  if (perUseTimes <= 0) {
    return {
      reserved: false,
      perUseTimes: 0,
      beforeTimes: null,
      afterTimes: null,
    };
  }

  const updated = await tx.memberCard.updateManyAndReturn({
    where: {
      id: params.snapshot.cardId,
      storeId: params.storeId,
      status: 'active',
      remainTimes: { gte: perUseTimes },
    },
    data: { remainTimes: { decrement: perUseTimes } },
    select: { remainTimes: true },
  });

  if (updated.length !== 1) {
    throw new ConflictException('该会员卡剩余次数不足，请重新识别会员后再开台');
  }

  const afterTimes = updated[0].remainTimes;
  if (afterTimes === null) {
    throw new ConflictException('该会员卡次数账实异常，请联系统管理员核对');
  }
  const beforeTimes = afterTimes + perUseTimes;

  const transaction = await tx.memberCardTransaction.create({
    data: {
      storeId: params.storeId,
      cardId: params.snapshot.cardId,
      changeType: 'reserve',
      status: 'pending',
      deltaTimes: -perUseTimes,
      beforeTimes,
      afterTimes,
      relatedSessionId: params.sessionId,
      relatedSpaceNameSnapshot: params.spaceNameSnapshot,
      operatorType: 'cashier',
      operatorStaffId: params.operatorStaffId ?? null,
      operatorName: params.operatorNameSnapshot ?? null,
      remark: '开台预扣次数',
    },
    select: { id: true },
  });

  return {
    reserved: true,
    perUseTimes,
    beforeTimes,
    afterTimes,
    transactionId: transaction.id,
  };
}

/**
 * 取消 / 失败补偿：释放会话已预扣的次数。
 *
 * - 只处理 changeType=reserve 且 status=pending 的流水，天然幂等：
 *   先按 pending 条件置 cancelled（命中 0 行说明已被结账确认或已释放），再回加次数；
 * - 回加走 increment 原子更新，并在同一事务内追加 release 流水，保证「次数变化 = 流水之和」。
 *
 * 说明：开台预扣与建台在同一事务内完成，开台失败由数据库回滚兜底，
 * 本函数服务于「开台成功后取消 / 结账前作废」这类跨事务场景。
 */
export async function releaseMemberCardReservation(
  tx: Prisma.TransactionClient,
  params: ReleaseMemberCardParams,
): Promise<MemberCardReleaseResult> {
  const pendingReservations = await tx.memberCardTransaction.findMany({
    where: {
      relatedSessionId: params.sessionId,
      changeType: 'reserve',
      status: 'pending',
      ...(params.cardId === undefined ? {} : { cardId: params.cardId }),
    },
    select: {
      id: true,
      storeId: true,
      cardId: true,
      deltaTimes: true,
      relatedSpaceNameSnapshot: true,
    },
  });

  let releasedTransactions = 0;
  let restoredTimes = 0;

  for (const reservation of pendingReservations) {
    const cancelled = await tx.memberCardTransaction.updateMany({
      where: { id: reservation.id, status: 'pending' },
      data: {
        status: 'cancelled',
        remark: params.remark ?? '开台取消释放预扣',
      },
    });
    if (cancelled.count !== 1) {
      continue;
    }

    releasedTransactions += 1;
    const releaseTimes = Math.abs(reservation.deltaTimes);
    if (releaseTimes === 0) {
      continue;
    }

    const restored = await tx.memberCard.updateManyAndReturn({
      where: { id: reservation.cardId },
      data: { remainTimes: { increment: releaseTimes } },
      select: { remainTimes: true },
    });
    const afterTimes = restored[0]?.remainTimes ?? null;

    await tx.memberCardTransaction.create({
      data: {
        storeId: reservation.storeId,
        cardId: reservation.cardId,
        changeType: 'release',
        status: 'done',
        deltaTimes: releaseTimes,
        beforeTimes: afterTimes === null ? null : afterTimes - releaseTimes,
        afterTimes,
        relatedSessionId: params.sessionId,
        relatedSpaceNameSnapshot: reservation.relatedSpaceNameSnapshot,
        operatorType: 'cashier',
        remark: params.remark ?? '开台取消释放预扣',
      },
      select: { id: true },
    });

    restoredTimes += releaseTimes;
  }

  return { releasedTransactions, restoredTimes };
}
