import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  MembershipPlanConfig,
  MembershipPlanRuleConfig,
  MembershipPlanSettingIdValue,
  MembershipPlanSettingRecord,
} from './platform-membership.types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const POINTS_RATE = 100;
export const POINTS_DEDUCT_LIMIT = 0.3;
export const BEAN_DEDUCT_RATE = 100;
export const BEAN_DEDUCT_LIMIT = 0.5;

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
    price: 3800,
    originalPrice: 3800,
    durationMonths: 1,
    validDays: null,
  },
  quarterly: {
    planId: 'quarterly',
    planName: '季度会员',
    price: 9900,
    originalPrice: 11400,
    durationMonths: 3,
    validDays: null,
  },
  yearly: {
    planId: 'yearly',
    planName: '年度会员',
    price: 36900,
    originalPrice: 45600,
    durationMonths: 12,
    validDays: null,
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

export const PLAN_BADGE_CONFIG: Record<
  PlatformMembershipPlanId,
  Pick<MembershipPlanConfig, 'badge' | 'recommended'>
> = {
  monthly: {},
  quarterly: {
    badge: '省15元',
    recommended: true,
  },
  yearly: {
    badge: '超划算',
  },
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
