import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';

export type MembershipRuntimeLevel = 'free' | PlatformMembershipPlanId;

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
