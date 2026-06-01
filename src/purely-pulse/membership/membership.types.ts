import { StoreSubAccountStatus } from '@prisma/client';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';

export type PulseMembershipPlanId =
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

export type PulseMemberStatusValue = 'active' | 'inactive' | 'banned';

export type PulseMemberLevelValue =
  | 'free'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'lifetime';

export type PulseRechargeChannelValue = 'wechat' | 'alipay' | 'card';

export type PulseSubAccountRoleValue = 'cashier' | 'finance' | 'manager';

export type PulseSubAccountStatusValue = StoreSubAccountStatus;

export type PulseAdminMemberLevel = PulseMemberLevelValue;

export interface PulseAdminMembershipProfileRecord {
  currentPlanId: PulseMembershipPlanId | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
  subAccountQuota: number;
}

export interface PulseAdminMembershipOrderRecord {
  id: number;
  planId: PulseMembershipPlanId;
  planName: string;
  amount: number;
  createdAt: Date;
}

export interface PulseAdminStoreIdentityRecord {
  name: string;
  contactPhone: string | null;
  owner: {
    email: string;
    name: string | null;
    realName: string | null;
  };
}

export interface PulseAdminStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PulseAdminPartnerRecord {
  id: number;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
}

export interface PulseDeveloperPointsProfileRecord {
  storeId: number;
  currentPlanId: PulseMembershipPlanId | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
}

export interface PulseDeveloperPointsLogRecord {
  id: number;
  source: 'purchase_bonus' | 'deduct_payment' | 'admin_adjust' | 'expire';
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
}

export interface PulseDeveloperBeanPartnerRecord {
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
}

export interface PulseDeveloperBeanLogRecord {
  id: number;
  source: 'promo_reward' | 'deduct_payment' | 'withdrawal' | 'admin_adjust';
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedPlanType: PulseMembershipPlanId | null;
  relatedUser: string | null;
  createdAt: Date;
}

export interface PulseAdminMembershipMutationInput {
  userId?: string;
  memberId?: string;
  id?: string;
  level?: PulseAdminMemberLevel;
  memberLevel?: PulseAdminMemberLevel;
  membershipLevel?: PulseAdminMemberLevel;
  membershipExpiry?: number | null;
  expireAt?: number | null;
  expiryAt?: number | null;
}

export interface PulseAdminStatusMutationInput {
  userId?: string;
  memberId?: string;
  id?: string;
  status?: 'active' | 'inactive' | 'banned';
  memberStatus?: 'active' | 'inactive' | 'banned';
  reason?: string;
  remark?: string;
}

export interface PulseAdminSubAccountQuotaMutationRoleSummaryInput {
  slot: number;
  role: PulseSubAccountRoleValue;
  status?: StoreSubAccountStatus;
  isAssigned?: boolean;
}

export interface PulseAdminSubAccountQuotaMutationInput {
  quota: number;
  reason?: string;
  roleSummary?: PulseAdminSubAccountQuotaMutationRoleSummaryInput[];
}

export interface PulseAdminSubAccountSlotMutationInput {
  slotIndex: number;
  role: PulseSubAccountRoleValue;
  status?: StoreSubAccountStatus;
  employeeId?: number | null;
  canAccessHome?: boolean;
  canUseHandover?: boolean;
  /** 可选：为子账号设置初始密码。仅在分配员工时生效，若员工尚无登录账号则会创建。 */
  initialPassword?: string;
}

export interface PulseAdminSubAccountDetail {
  eligible: boolean;
  quota: number;
  quotaMax: number;
  enabled: boolean;
  usedCount: number;
  availableCount: number;
  roleSummary: Array<{
    role: string;
    activeCount: number;
    inactiveCount: number;
    disabledCount: number;
    assignedCount: number;
  }>;
  slots: Array<{
    id: number;
    slotIndex: number;
    role: string;
    status: string;
    isAssigned: boolean;
    employeeId: number | null;
    employeeName: string | null;
    canAccessHome: boolean;
    canUseHandover: boolean;
  }>;
}

export interface PulseAdminMemberOrderSummary {
  rechargeCount: number;
  totalRecharged: number;
  lastPaidAt: number | null;
}

export interface PaymentPreviewResult {
  beanDeductAmount: number;
  actualBeansUsed: number;
  priceAfterBeans: number;
  pointsDeductAmount: number;
  actualPointsUsed: number;
  finalAmount: number;
}

export interface PulseMembershipAdjustmentInput {
  delta?: number;
  amount?: number;
  direction?: 'add' | 'subtract' | 'deduct' | 'reduce';
  reason: string;
}
