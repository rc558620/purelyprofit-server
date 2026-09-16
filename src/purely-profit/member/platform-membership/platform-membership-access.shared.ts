import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
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

/**
 * 会员能力矩阵（全平台唯一真相源）。
 *
 * 字段命名与前端 `MemberPlanCapabilities` 对齐（camelCase），后端写路径配额
 * （`MEMBERSHIP_RULES`）与下发前端的 `capabilities` 均由该表派生，避免前后端
 * 各维护一份常量导致口径漂移。
 */
export type MembershipCapabilities = {
  /** 生效档位，便于前端排查降级来源 */
  level: MembershipRuntimeLevel;
  /** 商品数上限，null 表示不限制 */
  productLimit: number | null;
  /** 商品分类上限，null 表示不限制 */
  categoryLimit: number | null;
  /** 员工数上限，null 表示不限制 */
  employeeLimit: number | null;
  /** 历史数据天数上限，null 表示不限时段 */
  historyLimitDays: number | null;
  /** 是否允许导出报表 */
  canExportReport: boolean;
  /** 购买套餐赠送积分数 */
  bonusPoints: number;
  /** 是否允许访问首页 */
  canAccessHome: boolean;
  /** 是否允许访问进货管理 */
  canAccessPurchaseManagement: boolean;
  /** 是否允许访问经营分析 */
  canAccessBusinessAnalysis: boolean;
  /** 是否允许访问财务管理 */
  canAccessFinance: boolean;
  /** 是否允许访问营销中心 */
  canAccessMarketing: boolean;
  /** 是否允许访问员工管理 */
  canAccessEmployeeManagement: boolean;
  /** 是否允许访问报表中心 */
  canAccessReportCenter: boolean;
  /** 是否允许访问员工交班 */
  canAccessHandover: boolean;
  /** 空间数上限，null 表示不限制 */
  spaceLimit: number | null;
  /** 是否允许配置子账号 */
  canUseSubAccount: boolean;
};

export const MEMBERSHIP_CAPABILITIES: Record<
  MembershipRuntimeLevel,
  MembershipCapabilities
> = {
  free: {
    level: 'free',
    productLimit: 3,
    categoryLimit: 1,
    employeeLimit: 0,
    historyLimitDays: 7,
    canExportReport: false,
    bonusPoints: 0,
    canAccessHome: true,
    canAccessPurchaseManagement: false,
    canAccessBusinessAnalysis: false,
    canAccessFinance: false,
    canAccessMarketing: false,
    canAccessEmployeeManagement: false,
    canAccessReportCenter: false,
    canAccessHandover: false,
    spaceLimit: 1,
    canUseSubAccount: false,
  },
  monthly: {
    level: 'monthly',
    productLimit: 30,
    categoryLimit: null,
    employeeLimit: 5,
    historyLimitDays: null,
    canExportReport: true,
    bonusPoints: 0,
    canAccessHome: true,
    canAccessPurchaseManagement: true,
    canAccessBusinessAnalysis: true,
    canAccessFinance: true,
    canAccessMarketing: true,
    canAccessEmployeeManagement: true,
    canAccessReportCenter: true,
    canAccessHandover: true,
    spaceLimit: 10,
    canUseSubAccount: false,
  },
  quarterly: {
    level: 'quarterly',
    productLimit: 100,
    categoryLimit: null,
    employeeLimit: 10,
    historyLimitDays: null,
    canExportReport: true,
    bonusPoints: 300,
    canAccessHome: true,
    canAccessPurchaseManagement: true,
    canAccessBusinessAnalysis: true,
    canAccessFinance: true,
    canAccessMarketing: true,
    canAccessEmployeeManagement: true,
    canAccessReportCenter: true,
    canAccessHandover: true,
    spaceLimit: 30,
    canUseSubAccount: false,
  },
  yearly: {
    level: 'yearly',
    productLimit: null,
    categoryLimit: null,
    employeeLimit: null,
    historyLimitDays: null,
    canExportReport: true,
    bonusPoints: 1500,
    canAccessHome: true,
    canAccessPurchaseManagement: true,
    canAccessBusinessAnalysis: true,
    canAccessFinance: true,
    canAccessMarketing: true,
    canAccessEmployeeManagement: true,
    canAccessReportCenter: true,
    canAccessHandover: true,
    spaceLimit: null,
    canUseSubAccount: true,
  },
  lifetime: {
    level: 'lifetime',
    productLimit: null,
    categoryLimit: null,
    employeeLimit: null,
    historyLimitDays: null,
    canExportReport: true,
    bonusPoints: 1500,
    canAccessHome: true,
    canAccessPurchaseManagement: true,
    canAccessBusinessAnalysis: true,
    canAccessFinance: true,
    canAccessMarketing: true,
    canAccessEmployeeManagement: true,
    canAccessReportCenter: true,
    canAccessHandover: true,
    spaceLimit: null,
    canUseSubAccount: true,
  },
};

/** 由能力矩阵派生的写路径配额规则，供 `PlatformMembershipAccessService` 消费 */
export const buildMembershipRuleConfig = (
  capabilities: MembershipCapabilities,
): MembershipRuleConfig => ({
  productLimit: capabilities.productLimit,
  employeeLimit: capabilities.employeeLimit,
  spaceLimit: capabilities.spaceLimit,
  historyDays: capabilities.historyLimitDays,
  reportExportEnabled: capabilities.canExportReport,
  financeEnabled: capabilities.canAccessFinance,
  marketingEnabled: capabilities.canAccessMarketing,
  subAccountEligible: capabilities.canUseSubAccount,
});

export const MEMBERSHIP_RULES: Record<
  MembershipRuntimeLevel,
  MembershipRuleConfig
> = {
  free: buildMembershipRuleConfig(MEMBERSHIP_CAPABILITIES.free),
  monthly: buildMembershipRuleConfig(MEMBERSHIP_CAPABILITIES.monthly),
  quarterly: buildMembershipRuleConfig(MEMBERSHIP_CAPABILITIES.quarterly),
  yearly: buildMembershipRuleConfig(MEMBERSHIP_CAPABILITIES.yearly),
  lifetime: buildMembershipRuleConfig(MEMBERSHIP_CAPABILITIES.lifetime),
};

/** 取指定档位的能力矩阵快照（返回副本，避免调用方改写常量） */
export function buildMembershipCapabilities(
  level: MembershipRuntimeLevel,
): MembershipCapabilities {
  return { ...MEMBERSHIP_CAPABILITIES[level] };
}

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

export function resolveMembershipLevel(
  profile: StoreMembershipProfileSnapshot | null,
  nowMs: number = Date.now(),
): MembershipRuntimeLevel {
  if (!profile?.currentPlanId) {
    return 'free';
  }

  if (isLegacyLifetimeProfile(profile)) {
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

/**
 * 历史兼容：早年 lifetime 枚举还没加时用 yearly + null expiresAt 表示永久会员，
 * 需同时满足 startsAt 存在才认定为 lifetime，防止数据异常被误判。
 */
function isLegacyLifetimeProfile(
  profile: StoreMembershipProfileSnapshot,
): boolean {
  return (
    profile.currentPlanId === 'yearly' &&
    profile.expiresAt === null &&
    profile.startsAt !== null
  );
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
