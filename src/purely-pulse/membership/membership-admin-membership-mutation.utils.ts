import { BadRequestException } from '@nestjs/common';
import { resolveStoredMembershipLevel } from '../../purely-profit/member/platform-membership/platform-membership-access.shared';
import { resolveEffectivePlanId } from '../../purely-profit/member/platform-membership/membership-plan-resolver';
import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import type { MembershipPlanConfig } from '../../purely-profit/member/platform-membership/platform-membership.types';
import { DAY_MS, MAX_MEMBERSHIP_PERIOD_COUNT } from './membership.constants';
import {
  resolveAmountFen,
  resolvePriceFen,
} from './membership-admin-money.utils';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseMembershipPlanId,
} from './membership.types';

/** 订单渠道：admin=计入收入，gift=赠送 */
export type AdminMembershipOrderChannel = 'admin' | 'gift';

/**
 * 管理端「设置会员等级」落盘前的纯解析 / 校验逻辑。
 *
 * 这些函数只吃入参、不触碰任何依赖，因此单独抽离便于单测与复用；
 * 需要套餐配置（有效期、单期天数）的两个异步函数通过 `getPlanConfig`
 * 回调注入，避免在纯函数里耦合 `PlatformMembershipService`。
 */
export type PlanConfigResolver = (
  planId: PulseMembershipPlanId,
) => Promise<MembershipPlanConfig>;

/**
 * 从 DTO 的多个别名里解析出目标档位；缺失即参数非法。
 *
 * 历史原因弹窗先后用过 `level` / `memberLevel` / `membershipLevel` 三个字段名，
 * 取第一个非空值，保证老调用方仍可用。
 */
export function resolveAdminMemberLevel(
  dto: PulseAdminMembershipMutationInput,
): PulseAdminMemberLevel {
  const nextLevel = dto.level ?? dto.memberLevel ?? dto.membershipLevel;
  if (!nextLevel) {
    throw new BadRequestException('缺少会员等级');
  }

  return nextLevel;
}

/**
 * 降级到免费会员的二次确认：当前会员仍在有效期内时必须显式确认，
 * 否则「设置免费」会瞬间清空档位、让客户掉出所有权益。
 */
export function assertFreeDowngradeConfirmed(
  profile: PulseAdminMembershipProfileRecord,
  dto: PulseAdminMembershipMutationInput,
  nextLevel: PulseAdminMemberLevel,
): void {
  if (nextLevel !== 'free') {
    return;
  }

  const isCurrentlyActive =
    profile.currentPlanId !== null &&
    profile.expiresAt !== null &&
    profile.expiresAt.getTime() > Date.now();

  if (!isCurrentlyActive) {
    return;
  }

  if (dto.confirmDowngradeToFree === true) {
    return;
  }

  throw new BadRequestException(
    '当前会员仍在有效期内，降级到免费会员需要显式确认',
  );
}

/** 管理端档位（annual/quarterly/...）→ 实际落盘档位 id；免费 / 非法档位返回 null。 */
export function toMembershipPlanId(
  level: PulseAdminMemberLevel,
): PulseMembershipPlanId | null {
  switch (level) {
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'annual':
      return 'yearly';
    case 'lifetime':
      return 'lifetime';
    default:
      return null;
  }
}

/**
 * 决定最终写入 `currentPlanId` 的档位，实现「只升不降」。
 *
 * - 当前会员**仍在有效期内**时，按 `PLAN_LEVEL_RANK` 取较高档位；
 *   想落回到更低的档位必须带 `confirmDowngradePlan`
 * - 当前会员**已到期 / 本身就是免费**时，没有「降」可言，直接采用目标档位
 *   （与商家端自助购买口径一致：`resolveEffectivePlanId(null, planId)`）
 */
export function resolveWritablePlanId(params: {
  profile: PulseAdminMembershipProfileRecord;
  targetPlanId: PulseMembershipPlanId | null;
  dto: PulseAdminMembershipMutationInput;
}): PulseMembershipPlanId | null {
  const { profile, targetPlanId, dto } = params;

  if (targetPlanId === null) {
    return null;
  }

  const isCurrentlyActive =
    profile.currentPlanId !== null &&
    profile.expiresAt !== null &&
    profile.expiresAt.getTime() > Date.now();

  if (!isCurrentlyActive) {
    return targetPlanId;
  }

  const keptPlanId = resolveEffectivePlanId(
    profile.currentPlanId,
    targetPlanId,
  );

  return keptPlanId === targetPlanId || dto.confirmDowngradePlan === true
    ? targetPlanId
    : keptPlanId;
}

/**
 * 新客额度的赠送期数：与追加时长同一口径，一期 = 一个完整档位周期。
 *
 * - 永久会员没有「期」的概念（弹窗也不给期数选项），固定 1 期
 * - 免费会员走清零分支，同样固定 1 期（值不会用到）
 * - 不传 / 非正整数 / 超过弹窗可选上限（12）一律按 1 期，避免异常值放大赠送
 */
export function resolveQuotaPeriodCount(
  targetLevel: PulseAdminMemberLevel,
  multiplier: number | undefined,
): number {
  if (targetLevel === 'lifetime' || targetLevel === 'free') return 1;
  if (
    !Number.isInteger(multiplier) ||
    (multiplier as number) < 1 ||
    (multiplier as number) > MAX_MEMBERSHIP_PERIOD_COUNT
  ) {
    return 1;
  }
  return multiplier as number;
}

/**
 * 解析降级到免费时需要转存的「原档位」`previousPlanId`。
 *
 * 设为免费会清空 `currentPlanId`，续费页由此无法判断「原本买的是哪一档」
 * （`resolveStoredMembershipLevel` 回落成 'free'），曾开通子账号功能的门店
 * 会被错判成年度档、丢掉 AGES(永久) 的续费入口，所以降级时必须先把原档位转存下来。
 *
 * 重新设置付费档位时返回 `null`：此时 `currentPlanId` 本身就是续费依据。
 *
 * 取 `resolveStoredMembershipLevel` 的结果（忽略到期判定），因此
 * 「已到期的年度会员」降级后原档位仍是年度，与续费保护的既有口径一致；
 * 历史永久会员（`yearly` + 无到期时间）也会被正确识别成 lifetime。
 */
export function resolveNextPreviousPlanId(params: {
  profile: PulseAdminMembershipProfileRecord;
  nextPlanId: PulseMembershipPlanId | null;
}): PulseMembershipPlanId | null {
  if (params.nextPlanId !== null) {
    return null;
  }

  const storedLevel = resolveStoredMembershipLevel({
    currentPlanId: params.profile.currentPlanId,
    previousPlanId: params.profile.previousPlanId ?? null,
    startsAt: params.profile.startsAt ?? null,
    expiresAt: params.profile.expiresAt,
  });

  return storedLevel === 'free' ? null : storedLevel;
}

/**
 * 解析目标档位的到期时间：优先采用调用方显式传入的时间，否则按档位默认值推算。
 *
 * - 免费会员永远 null（无到期）
 * - 永久会员取套餐 `validDays`（配置了才按有效期，否则 null）
 * - 其他付费档位必须显式传时间，否则视为参数非法
 */
export async function resolveAdminMembershipExpiry(
  dto: PulseAdminMembershipMutationInput,
  nextLevel: PulseAdminMemberLevel,
  getPlanConfig: PlanConfigResolver,
): Promise<Date | null> {
  const rawExpiry = dto.membershipExpiry ?? dto.expireAt ?? dto.expiryAt;
  if (rawExpiry !== null && rawExpiry !== undefined) {
    const explicitExpiry = new Date(rawExpiry);
    if (Number.isNaN(explicitExpiry.getTime())) {
      throw new BadRequestException('会员到期时间不合法');
    }
    return explicitExpiry;
  }

  if (nextLevel === 'free') {
    return null;
  }

  if (nextLevel === 'lifetime') {
    const lifetimePlan = await getPlanConfig('lifetime');
    if (lifetimePlan.validDays !== null && lifetimePlan.validDays > 0) {
      return new Date(Date.now() + lifetimePlan.validDays * DAY_MS);
    }
    return null;
  }

  throw new BadRequestException('缺少会员到期时间');
}

/**
 * 复核「追加多期」的到期时间：服务端不能只信前端算好的 expiry。
 *
 * 新客额度按 multiplier 叠加，时长却完全由调用方传入——两者脱钩时，
 * 直调接口可以 `multiplier: 12` 配 1 天时长，只送 1 天会员却拿走 12 期额度。
 * 因此多期请求必须满足 `到期时间 = 起算点 + 单期天数 × 期数`。
 *
 * 单期请求（`periodCount <= 1`）不校验：老调用方（补偿 / 迁移）会传任意到期时间，
 * 收紧它们会误伤既有流程，而单期本身没有放大赠送的空间。
 */
export async function assertMultiPeriodExpiry(
  params: {
    planId: PulseMembershipPlanId;
    periodCount: number;
    /** 起算点：仍在有效期内为原到期时间，否则为当下 */
    baseAt: Date;
    expiresAt: Date;
  },
  getPlanConfig: PlanConfigResolver,
): Promise<void> {
  const { planId, periodCount, baseAt, expiresAt } = params;
  if (periodCount <= 1) {
    return;
  }

  const plan = await getPlanConfig(planId);
  // 年度 / 永久用自然日 validDays，月 / 季回落到 durationMonths × 30
  const singlePeriodDays = plan.validDays ?? (plan.durationMonths ?? 0) * 30;
  if (singlePeriodDays <= 0) {
    return;
  }

  const expectedMs = singlePeriodDays * periodCount * DAY_MS;
  const actualMs = expiresAt.getTime() - baseAt.getTime();
  // 容忍前后端时钟差与「整月按 30 天」的口径差异，超出即视为参数不自洽
  const toleranceMs = 2 * DAY_MS;

  if (Math.abs(actualMs - expectedMs) > toleranceMs) {
    throw new BadRequestException(
      `追加 ${periodCount} 期的到期时间与套餐周期不符：应为 ${singlePeriodDays * periodCount} 天`,
    );
  }
}

/**
 * 计算管理端「设置会员等级」订单的金额与渠道。
 *
 * - 勾选计入收入：金额取成交价（解析不出则回落所选档位配置价），渠道 admin；
 * - 否则按赠送处理：金额 0，渠道 gift。
 *
 * 关键护栏：填了价却解析不出（'0' / 非法串）或配置价为 0 时**绝不回落配置价**，
 * 而是退回赠送——0 元落一笔 paid/admin 只会虚增成交笔数、营收一分没涨。
 */
export function resolveAdminMembershipOrderAmount(params: {
  /** 所选档位的配置价（分） */
  planPrice: number;
  /** 运营填的成交价展示值（元字符串），未填则回落配置价 */
  priceDisplay?: string;
  /** 是否计入收入 */
  countAsIncome: boolean;
}): {
  amount: number;
  paymentChannel: AdminMembershipOrderChannel;
  isIncome: boolean;
  /** 勾了「计入收入」但系统算不出金额，被按赠送处理 */
  forcedGift: boolean;
} {
  const hasPriceInput =
    typeof params.priceDisplay === 'string' &&
    params.priceDisplay.trim() !== '';
  const requestedAmount = hasPriceInput
    ? resolvePriceFen(params.priceDisplay)
    : params.planPrice;
  // 算不出来钱（填了 0、配置价为 0 等异常）却仍勾了「计入收入」：退回赠送处理
  const isIncome =
    params.countAsIncome && requestedAmount !== null && requestedAmount > 0;
  const amount = isIncome ? (requestedAmount as number) : 0;

  return {
    amount,
    paymentChannel: isIncome ? 'admin' : 'gift',
    isIncome,
    forcedGift: params.countAsIncome && !isIncome,
  };
}

/**
 * 构建管理端「设置会员等级」的成交价快照参数（不含事务执行器）。
 *
 * 仅对年 / 永久档位写入子账号分量；未录入字段 / 数量为 0 都不写，避免污染快照。
 * 价格解析不出（缺失 / 非法）时返回 null，表示本次不落成交价快照。
 */
export function buildDealPriceSnapshot(params: {
  /** 目标档位；为空（降级为免费）时不落成交价快照 */
  planId: PulseMembershipPlanId | null;
  priceDisplay?: string;
  subAccountCount?: number;
  subAccountAmountDisplay?: string;
}): {
  price: number;
  subAccountAmount?: number;
  subAccountCount?: number;
} | null {
  const price = resolvePriceFen(params.priceDisplay);
  const subAccountAmount = resolveAmountFen(params.subAccountAmountDisplay);

  if (!params.planId || price === null) {
    return null;
  }

  // 子账号分量只对年 / 永久档位有意义：月 / 季开不了子账号，
  // 即便请求里带了这两个字段也不得写入，避免污染快照
  const subAccountAllowed = isSubAccountPricingPlan(params.planId);
  const snapshot: {
    price: number;
    subAccountAmount?: number;
    subAccountCount?: number;
  } = { price };

  // 未录入的字段保持原值，不要把 NULL 写回去
  if (subAccountAllowed && subAccountAmount !== null) {
    snapshot.subAccountAmount = subAccountAmount;
  }
  // 数量 0 不写库：与「填了数量才同步开通配额」保持同一语义。
  // 写 0 会让续费卡显示「包含 0 个子账号」，而门店的实时配额并没被清掉
  if (
    subAccountAllowed &&
    params.subAccountCount !== undefined &&
    params.subAccountCount > 0
  ) {
    snapshot.subAccountCount = params.subAccountCount;
  }

  return snapshot;
}

/** 序列化「设置会员等级」审计事件（供 `logger.warn` 落日志）。 */
export function buildMembershipLevelMutationAuditEvent(params: {
  memberId: number;
  operatorUserId: number;
  operatorEmail: string;
  previousPlanId: PulseMembershipPlanId | null;
  previousExpiresAt: Date | null;
  nextLevel: PulseAdminMemberLevel;
  nextPlanId: PulseMembershipPlanId | null;
  nextExpiry: Date | null;
  confirmDowngradeToFree: boolean;
  actionSource: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}): Record<string, unknown> {
  return {
    event: 'pulse_admin_membership_level_mutation',
    memberId: params.memberId,
    operatorUserId: params.operatorUserId,
    operatorEmail: params.operatorEmail,
    previousPlanId: params.previousPlanId,
    previousExpiresAt: params.previousExpiresAt?.toISOString() ?? null,
    nextLevel: params.nextLevel,
    nextPlanId: params.nextPlanId,
    nextExpiry: params.nextExpiry?.toISOString() ?? null,
    confirmDowngradeToFree: params.confirmDowngradeToFree,
    actionSource: params.actionSource,
    requestId: params.requestId,
    ip: params.ip,
    userAgent: params.userAgent,
  };
}

/** 序列化「设置会员等级已落单」审计事件（供 `logger.warn` 落日志）。 */
export function buildMembershipOrderRecordedAuditEvent(params: {
  memberId: number;
  operatorUserId: number;
  operatorEmail: string;
  planId: PulseMembershipPlanId;
  amount: number;
  paymentChannel: AdminMembershipOrderChannel;
  countAsIncome: boolean;
  forcedGift: boolean;
}): Record<string, unknown> {
  return {
    event: 'pulse_admin_membership_order_recorded',
    memberId: params.memberId,
    operatorUserId: params.operatorUserId,
    operatorEmail: params.operatorEmail,
    planId: params.planId,
    amount: params.amount,
    paymentChannel: params.paymentChannel,
    countAsIncome: params.countAsIncome,
    forcedGift: params.forcedGift,
  };
}
