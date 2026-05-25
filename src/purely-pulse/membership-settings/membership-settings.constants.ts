import type { MembershipSettingPlanId } from './dto/membership-settings.dto';
import type { DefaultMembershipPlanSetting } from './membership-settings.types';

export const DEFAULT_MEMBERSHIP_PLAN_SETTINGS: Record<
  MembershipSettingPlanId,
  DefaultMembershipPlanSetting
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

export const MEMBERSHIP_SETTING_PLAN_ORDER: MembershipSettingPlanId[] = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
];
