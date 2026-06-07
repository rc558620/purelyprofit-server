import { SUB_ACCOUNT_QUOTA_MAX } from './platform-membership-access.shared';

export const MEMBERSHIP_ACCESS_MESSAGES = {
  financeDisabled: '当前会员套餐暂不支持财务管理，请升级会员后使用',
  marketingDisabled: '当前会员套餐暂不支持营销中心，请升级会员后使用',
  reportExportDisabled: '当前会员套餐暂不支持报表导出，请升级会员后使用',
  subAccountNotEligible:
    '当前会员等级暂不支持配置子账号，仅年会员或永久会员可开通',
  subAccountHandoverDisabled: '当前门店未启用子账号交班，请先配置子账号额度',
  subAccountQuotaMustBeInteger: '子账号额度必须是整数',
  membershipContextNotReady: '会员能力上下文未就绪，请联系管理员完成系统升级后重试',
  membershipContextNotReadyWarning:
    '[membership-access] store_membership_profiles.sub_account_quota schema not ready, deny request to avoid stale membership capability fallback',
} as const;

export function buildProductQuotaExceededMessage(limit: number): string {
  return `当前会员套餐最多可录入 ${limit} 个商品，请升级会员后继续添加`;
}

export function buildEmployeeQuotaExceededMessage(limit: number): string {
  return `当前会员套餐最多可管理 ${limit} 名在职员工，请升级会员后继续添加`;
}

export function buildSpaceQuotaExceededMessage(limit: number): string {
  return `当前会员套餐最多可创建 ${limit} 个空间，请升级会员后继续添加`;
}

export function buildSubAccountQuotaOutOfRangeMessage(): string {
  return `子账号额度必须在 0 到 ${SUB_ACCOUNT_QUOTA_MAX} 之间`;
}
