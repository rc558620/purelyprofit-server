import { BadRequestException } from '@nestjs/common';
import type { MembershipPlanConfig } from '../../purely-profit/member/platform-membership/platform-membership.types';
import { DAY_MS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseMembershipPlanId,
} from './membership.types';

/**
 * 管理端「设置会员等级」的到期时间解析与复核（纯函数）。
 *
 * 需要套餐配置（有效期、单期天数）的异步函数通过 `getPlanConfig` 回调注入，
 * 避免在纯函数里耦合 `PlatformMembershipService`。
 */
export type PlanConfigResolver = (
  planId: PulseMembershipPlanId,
) => Promise<MembershipPlanConfig>;

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
