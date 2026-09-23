// 新用户额度常量：计费单价、预警阈值、会员赠送与充值档位（单位统一为「位新客」）

/** 单个新客的微信 getPhoneNumber 调用成本（分）：0.03 元 */
export const NEW_CUSTOMER_QUOTA_UNIT_PRICE_FEN = 3;

/** 首页预警阈值：余额低于该值（位新客）时每天提醒 */
export const NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD = 100;

/** 会员档位键值：与 MembershipPlanCycle 对齐，free 为降级/未开通态 */
export type MembershipPlanGrantKey =
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'lifetime'
  | 'free';

/** 会员档位 → 赠送额度（位新客）；永久同年度，免费不赠送 */
export const PLAN_QUOTA_GRANT: Record<MembershipPlanGrantKey, number> = {
  monthly: 50,
  quarterly: 100,
  yearly: 300,
  lifetime: 300,
  free: 0,
};

/** 会员档位展示名，用于流水说明 */
export const PLAN_QUOTA_GRANT_LABEL: Record<MembershipPlanGrantKey, string> = {
  monthly: '月度会员',
  quarterly: '季度会员',
  yearly: '年度会员',
  lifetime: '永久会员',
  free: '免费会员',
};

/** 可选充值档位（分）：10 / 50 / 100 元 */
export const RECHARGE_TIER_AMOUNT_FEN = [1000, 5000, 10000] as const;

/** 额度不足业务码：C 端据此提示「联系商家」，前端需同步 */
export const NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE = 'NEW_CUSTOMER_QUOTA_EXHAUSTED';

/** 额度不足提示文案（与 purelyClub 前端展示保持一致） */
export const NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE =
  '新用户额度已用完，当前无法下单，请联系商家';
