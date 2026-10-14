// 新用户额度领域计算：金额 → 新客数、档位赠送额度、展示格式化与入参归一化
import {
  NEW_CUSTOMER_QUOTA_UNIT_PRICE_FEN,
  PLAN_QUOTA_GRANT,
  PLAN_QUOTA_GRANT_LABEL,
  RECHARGE_TIER_AMOUNT_FEN,
  type MembershipPlanGrantKey,
} from './new-customer-quota.constants';
import type { NewCustomerQuotaLogTypeValue } from './new-customer-quota.types';

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

/** 充值金额必须是后端下发的档位之一，避免客户端按任意金额换算额度 */
export const isAllowedRechargeTier = (amountFen: number): boolean =>
  RECHARGE_TIER_AMOUNT_FEN.some((tier) => tier === amountFen);

/** 运营调额增量：非法值（NaN / Infinity）按 0 处理，且只认整数（分档粒度为「位」） */
export const normalizeQuotaDelta = (delta: number): number =>
  Math.trunc(Number.isFinite(delta) ? delta : 0);

/** 购买期数：非正整数一律按 1 期处理（老调用方不传即 1 期） */
export const normalizePeriodCount = (multiplier: number): number =>
  Number.isInteger(multiplier) && multiplier > 0 ? multiplier : 1;

/** 流水类型兜底：库里出现未知类型时按消耗展示，避免前端拿到 undefined */
export const normalizeLogType = (
  rawType: string,
): NewCustomerQuotaLogTypeValue => {
  if (
    rawType === 'recharge' ||
    rawType === 'grant' ||
    rawType === 'consume' ||
    rawType === 'clear' ||
    rawType === 'admin_adjust'
  ) {
    return rawType;
  }
  return 'consume';
};
