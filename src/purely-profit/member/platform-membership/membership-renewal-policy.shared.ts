import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { MembershipRuntimeLevel } from './platform-membership-access.service';

/**
 * 会员续费套餐规则（有子账号功能的门店只能续费原档位）。
 *
 * 业务背景：子账号功能仅年度 / 永久会员可用，一旦降级到月度 / 季度，
 * 后端 `normalizeSubAccountQuota` 会把配额归零、子账号能力立即失效。
 * 因此已开通子账号功能的门店必须屏蔽月度 / 季度，避免误降级。
 *
 * ⚠️ 判据是「**曾**开通子账号功能」（`pulseSubAccountQuota > 0`，到期不失效），
 * 不是实时能力：会员一到期，实时能力就会被归零，若以它为准，到期门店会看到
 * 月 / 季 / 年三档 —— 既能误降级丢子账号，又拿不到首购锁定价。
 */

/** 未开通子账号功能时可见的套餐档位（保持现状） */
export const DEFAULT_RENEWAL_PLAN_IDS: readonly PlatformMembershipPlanId[] = [
  'monthly',
  'quarterly',
  'yearly',
];

/** 已开通子账号功能时禁止购买的档位 */
export const SUB_ACCOUNT_BLOCKED_PLAN_IDS: readonly PlatformMembershipPlanId[] =
  ['monthly', 'quarterly'];

export const SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE =
  '当前账号已开通子账号功能，仅支持续费年度会员 / 永久会员';

/** 永久会员档位在续费页的展示名（平台侧文案统一为 AGES 会员） */
export const LIFETIME_RENEWAL_PLAN_DISPLAY_NAME = 'AGES会员';

/** 解析续费页可见（且可下单）的套餐档位 */
export function resolveVisibleRenewalPlanIds(params: {
  subAccountFeatureOwned: boolean;
  /**
   * 待续费档位。到期门店必须传**档案里保留的原档位**，不能传实时档位
   * （到期后实时档位已回落为 'free'，否则会把 AGES 门店错判成年度档）。
   */
  level: MembershipRuntimeLevel;
}): PlatformMembershipPlanId[] {
  const { subAccountFeatureOwned, level } = params;

  if (!subAccountFeatureOwned) {
    return [...DEFAULT_RENEWAL_PLAN_IDS];
  }

  // 永久会员是最高档：只保留永久卡，避免误降级
  if (level === 'lifetime') {
    return ['lifetime'];
  }

  // 年度会员（含到期后原档位、以及月 / 季脏数据的兜底）：只保留年度卡
  return ['yearly'];
}

/** 指定档位是否允许续费（曾开通子账号功能时禁止月 / 季） */
export function isRenewalPlanPurchasable(params: {
  planId: PlatformMembershipPlanId;
  subAccountFeatureOwned: boolean;
}): boolean {
  const { planId, subAccountFeatureOwned } = params;

  if (!subAccountFeatureOwned) {
    return true;
  }

  return !SUB_ACCOUNT_BLOCKED_PLAN_IDS.includes(planId);
}

/** 永久卡不展示划线原价与月均价（后端没有配置 durationMonths / originalPrice） */
export function shouldHideRenewalPlanPriceExtras(
  planId: PlatformMembershipPlanId,
): { hideOriginalPrice: boolean; hideMonthlyPrice: boolean } {
  const isLifetime = planId === 'lifetime';

  return {
    hideOriginalPrice: isLifetime,
    hideMonthlyPrice: isLifetime,
  };
}
