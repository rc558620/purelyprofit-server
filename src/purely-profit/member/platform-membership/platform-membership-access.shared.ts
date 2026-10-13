import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import {
  isLegacyLifetimeProfile,
  resolveMembershipLevel,
} from './membership-expiry.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import {
  MEMBERSHIP_RULES,
  buildMembershipCapabilities,
} from './membership-capabilities.shared';
import type {
  MembershipCapabilities,
  MembershipRuleConfig,
  MembershipRuntimeLevel,
} from './membership-capabilities.shared';

/** 能力矩阵已抽离到 `membership-capabilities.shared`，此处透出以保持既有引用入口不变 */
export type {
  MembershipCapabilities,
  MembershipRuleConfig,
  MembershipRuntimeLevel,
} from './membership-capabilities.shared';
export { buildMembershipCapabilities } from './membership-capabilities.shared';

/**
 * 实时档位判定已抽离到 `membership-expiry.utils`，此处透出以保持既有引用入口不变。
 *
 * ⚠️ 不要在此处另写一份过期判断：一旦与 `membership-expiry.utils` 漂移，
 * 就会出现「配额按已过期收紧、续费横幅却说不欠费」（或反之）的静默降级。
 */
export {
  isMembershipDowngraded,
  isMembershipProfileActive,
  resolveMembershipExpiry,
  resolveMembershipLevel,
} from './membership-expiry.utils';
export type {
  MembershipDowngradeProfile,
  MembershipExpiryProfile,
  MembershipExpirySource,
  ResolvedMembershipExpiry,
} from './membership-expiry.utils';

export type SubAccountQuotaValidationIssue = 'not_integer' | 'out_of_range';

export type StoreMembershipProfileSnapshot = {
  currentPlanId: PlatformMembershipPlanId | null;
  /**
   * 降级到免费时保留的原档位。
   *
   * 设为免费会把 `currentPlanId` 清空，此时档案里只剩本字段能回答
   * 「原本买的是哪一档」；`resolveStoredMembershipLevel` 必须回落读取它，
   * 否则 AGES 门店会被错判成年度档、续费页丢掉 AGES 卡。
   */
  previousPlanId?: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  subAccountQuota?: number;
  pulseSubAccountQuota?: number | null;
};

export interface MembershipRuleSnapshot extends MembershipRuleConfig {
  level: MembershipRuntimeLevel;
}

export interface SubAccountBenefitSnapshot {
  level: MembershipRuntimeLevel;
  eligible: boolean;
  quota: number;
  quotaMax: number;
  enabled: boolean;
  rawQuota: number;
  /**
   * 是否**曾开通**子账号功能（`pulseSubAccountQuota > 0`）——到期不失效。
   *
   * 与 `enabled` 严格区分：`enabled` 是实时能力，会员一到期就会被
   * `normalizeSubAccountQuota` 归零；续费页的档位裁剪 / 首购锁定价 /
   * 含子账号权益的展示都必须以本字段为准，否则门店会在到期那一刻丢掉保护
   * —— 而这正是最需要续费的时刻。
   */
  featureOwned: boolean;
  /** 上次开通的档位（忽略到期判定，档位在会员档案里仍保留）；从未开通为 'free' */
  previousLevel: MembershipRuntimeLevel;
}

export interface SubAccountRoleSnapshot {
  role: StoreSubAccountRole;
  status: StoreSubAccountStatus;
  canAccessHome: boolean;
  canUseHandover: boolean;
}

export interface HistoryRange {
  start: number;
  end: number;
}

export interface ClampedHistoryRange extends HistoryRange {
  clamped: boolean;
  empty: boolean;
}

export const SUB_ACCOUNT_QUOTA_MAX = 10;

/** 由会员档案推导并下发的能力矩阵 */
export function buildMembershipCapabilitiesSnapshot(
  profile: StoreMembershipProfileSnapshot | null,
): MembershipCapabilities {
  return buildMembershipCapabilities(resolveMembershipLevel(profile));
}

export function buildMembershipRuleSnapshot(
  profile: StoreMembershipProfileSnapshot | null,
): MembershipRuleSnapshot {
  const level = resolveMembershipLevel(profile);
  return {
    level,
    ...MEMBERSHIP_RULES[level],
  };
}

export function buildSubAccountBenefitSnapshot(
  profile: StoreMembershipProfileSnapshot | null,
): SubAccountBenefitSnapshot {
  const rule = buildMembershipRuleSnapshot(profile);
  const rawQuota = profile?.pulseSubAccountQuota ?? 0;
  const quota = normalizeSubAccountQuota(rawQuota, rule.subAccountEligible);

  return {
    level: rule.level,
    eligible: rule.subAccountEligible,
    quota,
    quotaMax: rule.subAccountEligible ? SUB_ACCOUNT_QUOTA_MAX : 0,
    enabled: quota > 0,
    rawQuota,
    featureOwned: rawQuota > 0,
    previousLevel: resolveStoredMembershipLevel(profile),
  };
}

/**
 * 解析会员档案里记录的档位，**忽略到期判定**。
 *
 * `resolveMembershipLevel` 在到期后会返回 'free'，续费页据此无法判断
 * 「原本买的是哪一档」；而续费必须按原档位续（AGES 续 AGES、年度续年度），
 * 所以这里跳过过期检查，直接取档案里保留的档位。
 *
 * 档位有两个来源，按优先级回落：
 * 1. `currentPlanId` —— 档案当前档位（到期后仍保留）
 * 2. `previousPlanId` —— 被设为免费时转存的原档位（此时 `currentPlanId` 已清空）
 *
 * 少了第 2 步，永久会员被设为免费后会回落成 'free'，续费页只剩年度卡。
 */
export function resolveStoredMembershipLevel(
  profile: StoreMembershipProfileSnapshot | null,
): MembershipRuntimeLevel {
  if (!profile) {
    return 'free';
  }

  if (isLegacyLifetimeProfile(profile)) {
    return 'lifetime';
  }

  const storedPlanId = profile.currentPlanId ?? profile.previousPlanId ?? null;
  if (!storedPlanId) {
    return 'free';
  }

  return storedPlanId;
}

export function normalizeSubAccountQuota(
  rawQuota: number,
  eligible: boolean,
): number {
  if (!eligible || !Number.isInteger(rawQuota)) {
    return 0;
  }

  return Math.min(Math.max(rawQuota, 0), SUB_ACCOUNT_QUOTA_MAX);
}

export function getSubAccountQuotaValidationIssue(
  quota: number,
): SubAccountQuotaValidationIssue | null {
  if (!Number.isInteger(quota)) {
    return 'not_integer';
  }

  if (quota < 0 || quota > SUB_ACCOUNT_QUOTA_MAX) {
    return 'out_of_range';
  }

  return null;
}

export function getHistoryWindowStartFromDays(
  days: number,
  now: Date = new Date(),
): number {
  // 上海时区下「近 N 天」的起点零点
  return addShanghaiDays(getShanghaiDayStartMs(now.getTime()), -days + 1);
}

export function clampHistoryRangeByWindow(
  range: HistoryRange,
  historyWindowStart: number | null,
): ClampedHistoryRange {
  if (historyWindowStart === null) {
    return {
      start: range.start,
      end: range.end,
      clamped: false,
      empty: range.end < range.start,
    };
  }

  if (range.end < historyWindowStart) {
    return {
      start: historyWindowStart,
      end: historyWindowStart - 1,
      clamped: true,
      empty: true,
    };
  }

  return {
    start: Math.max(range.start, historyWindowStart),
    end: range.end,
    clamped: range.start < historyWindowStart,
    empty: false,
  };
}

export function createSubAccountRoleSnapshot(
  role: StoreSubAccountRole,
  status: StoreSubAccountStatus,
  canAccessHome: boolean,
  canUseHandover: boolean,
): SubAccountRoleSnapshot {
  return {
    role,
    status,
    canAccessHome,
    canUseHandover,
  };
}

export function isMissingSubAccountQuotaSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (
    !message.includes('sub_account_quota') &&
    !message.includes('subaccountquota')
  ) {
    return false;
  }

  return (
    message.includes('does not exist') ||
    message.includes("doesn't exist") ||
    message.includes('unknown column') ||
    message.includes('no such column') ||
    message.includes('unknown field') ||
    message.includes('column')
  );
}
