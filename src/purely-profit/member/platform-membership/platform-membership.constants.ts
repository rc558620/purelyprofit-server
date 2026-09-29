import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  MembershipPlanConfig,
  MembershipPlanRuleConfig,
  MembershipPlanSettingIdValue,
  MembershipPlanSettingRecord,
  PartnerLevelValue,
} from './platform-membership.types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const POINTS_RATE = 100;
export const POINTS_DEDUCT_LIMIT = 0.3;
export const BEAN_DEDUCT_RATE = 100;
export const BEAN_DEDUCT_LIMIT = 0.5;

/**
 * 可开通子账号能力的档位：仅年 / 永久。
 *
 * 月 / 季会员开不了子账号，因此它们的成交快照**永远不应该**有子账号加价，
 * 补录、预览、定价、续费卡展示都必须以此白名单为准。
 */
export const SUB_ACCOUNT_PRICING_PLAN_IDS: readonly PlatformMembershipPlanId[] =
  ['yearly', 'lifetime'];

export function isSubAccountPricingPlan(
  planId: PlatformMembershipPlanId,
): boolean {
  return SUB_ACCOUNT_PRICING_PLAN_IDS.includes(planId);
}

/**
 * 门店是否「含子账号权益」——档位裁剪与「月 / 季能否改价」的共同判据。
 *
 * 必须用「曾开通」口径（`pulseSubAccountQuota > 0`，到期不失效）而非实时配额：
 * 会员到期后实时配额被收回归零，但续费卡仍要展示「包含 x 个子账号」、
 * 仍要只给年 / 永久档。用实时口径会出现「到期后月 / 季又能买了」的矛盾。
 *
 * 另外即便没开通子账号，只要运营历史上录过子账号加价，价格里就含这部分，
 * 同样要按含子账号处理——否则会按纯配置价续费，白送子账号。
 */
export function hasSubAccountPricingEntitlement(context: {
  subAccountFeatureOwned: boolean;
  lockedSubAccountAmounts: Map<PlatformMembershipPlanId, number>;
}): boolean {
  return (
    context.subAccountFeatureOwned ||
    [...context.lockedSubAccountAmounts.keys()].some(isSubAccountPricingPlan)
  );
}

/**
 * 续费定价公式的**唯一实现**：`max(当前配置价, 议定价) + 子账号加价`。
 *
 * 结算（下单预览 / 下单落库）、商家端续费卡、管理端预览与会员详情展示
 * 都必须调用本函数，不得各自手抄公式——只要有一处漏改就会出现
 * 「看到的价格 ≠ 实际扣款」。
 *
 * - 配置价与议定价**取高者**，因为两者回答的是不同问题：
 *   配置价是平台对该档位的当前标准价，议定价是运营为「单个门店 x 单个档位」
 *   谈下来的保价。配置价上调必须传导到所有门店——议定价低于配置价时仍按配置价收，
 *   否则「调整续费价格」里一个陈旧的低价会把平台涨价永久压住；
 *   而当议定价高于配置价时（成交价高于标准价的客户），配置价也不能把它吞掉。
 * - `议定价` 取代的只是**基数**，不是最终价，因此年 / 永久档位的子账号加价仍叠加，
 *   两者正交。
 * - 用 `typeof === 'number'` 判定而非真值判断：0 是合法入参（不能当成「未设置」），
 *   但按取高者口径，0 会回落到配置价——议定价只用于抬价，不能让档位变免费。
 */
export function resolveRenewalPriceFen(params: {
  planId: PlatformMembershipPlanId;
  /** 当前配置价（分） */
  configPrice: number;
  /** 该门店该档位的议定价（分）；null / undefined 表示未议定 */
  overridePrice?: number | null;
  /** 子账号加价（分）；只对年 / 永久档位生效 */
  subAccountAmount?: number | null;
}): number {
  const { planId, configPrice, overridePrice, subAccountAmount } = params;

  const basePrice =
    typeof overridePrice === 'number'
      ? Math.max(configPrice, overridePrice)
      : configPrice;
  const amount = isSubAccountPricingPlan(planId) ? (subAccountAmount ?? 0) : 0;

  return basePrice + amount;
}

/** 合伙人推广奖励纯利豆数量（按等级 x 套餐） */
export const PROMO_BEAN_REWARDS_BY_LEVEL: Record<
  PartnerLevelValue,
  Record<PlatformMembershipPlanId, number>
> = {
  star: {
    monthly: 8,
    quarterly: 22,
    yearly: 92,
    lifetime: 0,
  },
  elite: {
    monthly: 9,
    quarterly: 24,
    yearly: 102,
    lifetime: 0,
  },
  legend: {
    monthly: 10,
    quarterly: 28,
    yearly: 116,
    lifetime: 0,
  },
};

export const PURCHASE_BONUS_POINTS: Record<PlatformMembershipPlanId, number> = {
  monthly: 0,
  quarterly: 300,
  yearly: 1500,
  lifetime: 0,
};

export const PLAN_LEVEL_RANK: Record<PlatformMembershipPlanId, number> = {
  monthly: 1,
  quarterly: 2,
  yearly: 3,
  lifetime: 4,
};

export const PLATFORM_MEMBERSHIP_PLAN_ORDER: PlatformMembershipPlanId[] = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
];

export const DEFAULT_MEMBERSHIP_PLAN_SETTINGS: Record<
  MembershipPlanSettingIdValue,
  Omit<MembershipPlanSettingRecord, 'updatedAt'>
> = {
  monthly: {
    planId: 'monthly',
    planName: '月度会员',
    price: 4200,
    // 划线原价（108 元）；月均价 42 元/月，角标由 resolvePlanBadge 算出
    originalPrice: 10800,
    durationMonths: 1,
    validDays: null,
  },
  quarterly: {
    planId: 'quarterly',
    planName: '季度会员',
    price: 10800,
    // 划线原价（298 元）
    originalPrice: 29800,
    durationMonths: 3,
    validDays: null,
  },
  yearly: {
    planId: 'yearly',
    planName: '年度会员',
    price: 39800,
    // 划线原价（998 元）
    originalPrice: 99800,
    // durationMonths 用于月均价展示；有效期优先按 validDays（自然年 365 天）计算
    durationMonths: 12,
    validDays: 365,
  },
  lifetime: {
    planId: 'lifetime',
    planName: '永久会员',
    price: 39800,
    originalPrice: null,
    durationMonths: null,
    validDays: 730,
  },
};

/**
 * 各档位的「主推」标记。
 *
 * 注意：角标文案（`省X元`）不在本表里，而是由 `resolvePlanBadge` 按
 * 「划线原价 − 实付价」实时算出——写死文案会在每次调价后与划线价对不上。
 */
export const PLAN_RECOMMEND_CONFIG: Record<
  PlatformMembershipPlanId,
  Pick<MembershipPlanConfig, 'recommended'>
> = {
  monthly: {},
  quarterly: {},
  yearly: { recommended: true },
  lifetime: {},
};

export const PLAN_RULES: MembershipPlanRuleConfig[] = [
  {
    key: 'product_limit',
    name: '商品录入',
    free: '最多 3 个',
    monthly: '最多 30 个',
    quarterly: '最多 100 个',
    yearly: '无上限',
  },
  {
    key: 'staff_limit',
    name: '员工管理',
    free: '0 人',
    monthly: '最多 5 人',
    quarterly: '最多 10 人',
    yearly: '无上限',
  },
  {
    key: 'history_range',
    name: '历史数据',
    free: '近 7 天',
    monthly: '不限时段',
    quarterly: '不限时段',
    yearly: '不限时段',
  },
  {
    key: 'report_export',
    name: '报表导出',
    free: '不可用',
    monthly: '可用',
    quarterly: '可用',
    yearly: '可用',
  },
  {
    key: 'bonus_points',
    name: '赠送积分',
    free: '0 分',
    monthly: '0 分',
    quarterly: '赠 300 分',
    yearly: '赠 1500 分',
  },
  {
    key: 'finance_access',
    name: '财务管理',
    free: '不可用',
    monthly: '可用',
    quarterly: '可用',
    yearly: '可用',
  },
  {
    key: 'marketing_access',
    name: '营销中心',
    free: '不可用',
    monthly: '可用',
    quarterly: '可用',
    yearly: '可用',
  },
  {
    key: 'space_limit',
    name: '空间管理',
    free: '最多 1 个',
    monthly: '最多 10 个',
    quarterly: '最多 30 个',
    yearly: '无上限',
  },
];
