import {
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { resolveFrontendMembershipExpiry } from './membership-expiry.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';

export type MembershipRuntimeLevel = 'free' | PlatformMembershipPlanId;
export type SubAccountQuotaValidationIssue = 'not_integer' | 'out_of_range';

export type MembershipRuleConfig = {
  productLimit: number | null;
  employeeLimit: number | null;
  spaceLimit: number | null;
  historyDays: number | null;
  reportExportEnabled: boolean;
  financeEnabled: boolean;
  marketingEnabled: boolean;
  subAccountEligible: boolean;
};

export type StoreMembershipProfileSnapshot = {
  currentPlanId: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  subAccountQuota: number;
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

export const MEMBERSHIP_RULES: Record<
  MembershipRuntimeLevel,
  MembershipRuleConfig
> = {
  free: {
    productLimit: 3,
    employeeLimit: 0,
    spaceLimit: 1,
    historyDays: 7,
    reportExportEnabled: false,
    financeEnabled: false,
    marketingEnabled: false,
    subAccountEligible: false,
  },
  monthly: {
    productLimit: 30,
    employeeLimit: 5,
    spaceLimit: 10,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: false,
  },
  quarterly: {
    productLimit: 100,
    employeeLimit: 10,
    spaceLimit: 30,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: false,
  },
  yearly: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: true,
  },
  lifetime: {
    productLimit: null,
    employeeLimit: null,
    spaceLimit: null,
    historyDays: null,
    reportExportEnabled: true,
    financeEnabled: true,
    marketingEnabled: true,
    subAccountEligible: true,
  },
};

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
  const rawQuota = profile?.subAccountQuota ?? 0;
  const quota = normalizeSubAccountQuota(rawQuota, rule.subAccountEligible);

  return {
    level: rule.level,
    eligible: rule.subAccountEligible,
    quota,
    quotaMax: rule.subAccountEligible ? SUB_ACCOUNT_QUOTA_MAX : 0,
    enabled: quota > 0,
    rawQuota,
  };
}

export function resolveMembershipLevel(
  profile: StoreMembershipProfileSnapshot | null,
  nowMs: number = Date.now(),
): MembershipRuntimeLevel {
  if (!profile?.currentPlanId) {
    return 'free';
  }

  if (profile.currentPlanId === 'yearly' && profile.expiresAt === null) {
    return 'lifetime';
  }

  const expiresAt = resolveFrontendMembershipExpiry(profile);
  if (profile.currentPlanId === 'lifetime' && expiresAt === null) {
    return 'lifetime';
  }

  if (!expiresAt || expiresAt.getTime() <= nowMs) {
    return 'free';
  }

  return profile.currentPlanId;
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
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days + 1,
    0,
    0,
    0,
    0,
  ).getTime();
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
