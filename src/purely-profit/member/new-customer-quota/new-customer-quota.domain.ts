// 新用户额度领域计算：金额 → 新客数、档位赠送额度、展示格式化
import {
  NEW_CUSTOMER_QUOTA_UNIT_PRICE_FEN,
  PLAN_QUOTA_GRANT,
  PLAN_QUOTA_GRANT_LABEL,
  type MembershipPlanGrantKey,
} from './new-customer-quota.constants';

const isPlanGrantKey = (value: string): value is MembershipPlanGrantKey =>
  value === 'monthly' ||
  value === 'quarterly' ||
  value === 'yearly' ||
  value === 'lifetime' ||
  value === 'free';

/** 按充值金额（分）计算可得新客数：向下取整，与微信计费成本对齐 */
export const calcQuotaByAmountFen = (amountFen: number): number =>
  Math.floor(amountFen / NEW_CUSTOMER_QUOTA_UNIT_PRICE_FEN);

/** 会员档位 → 赠送额度（位新客）；未知档位返回 0 */
export const resolvePlanGrant = (planId: string | null | undefined): number => {
  if (!planId || !isPlanGrantKey(planId)) return 0;
  return PLAN_QUOTA_GRANT[planId];
};

/** 会员档位 → 展示名，用于流水说明 */
export const resolvePlanGrantLabel = (
  planId: string | null | undefined,
): string => {
  if (!planId || !isPlanGrantKey(planId)) return '会员';
  return PLAN_QUOTA_GRANT_LABEL[planId];
};

/** 金额（分）→ 展示文案（如 ¥10、¥100），仅格式化不做业务计算 */
export const formatAmountFenToYuanDisplay = (amountFen: number): string =>
  `¥${Math.trunc(amountFen / 100)}`;
