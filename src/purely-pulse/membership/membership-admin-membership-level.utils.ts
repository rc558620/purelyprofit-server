import { BadRequestException } from '@nestjs/common';
import { resolveStoredMembershipLevel } from '../../purely-profit/member/platform-membership/platform-membership-access.shared';
import { resolveEffectivePlanId } from '../../purely-profit/member/platform-membership/membership-plan-resolver';
import { MAX_MEMBERSHIP_PERIOD_COUNT } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseMembershipPlanId,
} from './membership.types';

/**
 * 管理端「设置会员等级」的档位解析与校验（纯函数）。
 *
 * 这些函数只吃入参、不触碰任何依赖，因此单独抽离便于单测与复用。
 */

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
