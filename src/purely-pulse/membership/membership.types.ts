import { StoreSubAccountStatus } from '@prisma/client';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type { MembershipPaymentChannelValue } from '../../purely-profit/member/platform-membership/platform-membership.types';

export type PulseMembershipPlanId =
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

export type PulseMemberStatusValue =
  | 'active'
  | 'inactive'
  | 'banned'
  | 'cancelled';

export type PulseMemberLevelValue =
  | 'free'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'lifetime';

export type PulseRechargeChannelValue =
  | 'wechat'
  | 'alipay'
  | 'card'
  | 'admin'
  | 'gift';

export type PulseSubAccountRoleValue = 'cashier' | 'finance' | 'manager';

export type PulseSubAccountStatusValue = StoreSubAccountStatus;

export type PulseAdminMemberLevel = PulseMemberLevelValue;

export interface PulseAdminMembershipProfileRecord {
  currentPlanId: PulseMembershipPlanId | null;
  /**
   * 降级到免费时保留的原档位（此时 `currentPlanId` 已清空）。
   *
   * 续费必须按原档位续（AGES 续 AGES），缺少本字段会让永久会员被设为免费后
   * 回落成 'free'，续费页只剩年度卡。
   */
  previousPlanId?: PulseMembershipPlanId | null;
  /** 档案首次写入时间；非空表示档案已被显式管理，用于兼容历史永久会员判定 */
  startsAt?: Date | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
  subAccountQuota: number;
  pulseSubAccountQuota: number | null;
}

export interface PulseAdminMembershipOrderRecord {
  id: number;
  planId: PulseMembershipPlanId;
  planName: string;
  amount: number;
  /** wechat=商家端充值；admin=管理端设置且计入收入；gift=管理端设置按赠送 */
  paymentChannel: MembershipPaymentChannelValue;
  createdAt: Date;
}

export interface PulseAdminStoreIdentityRecord {
  name: string;
  contactPhone: string | null;
  owner: {
    email: string;
    name: string | null;
    realName: string | null;
    avatar: string | null;
    wechatPhone: string | null;
    lastActiveAt: Date | null;
  };
}

export interface PulseAdminStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
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
  changeType: 'increase' | 'decrease';
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
}

export interface PulseDeveloperBeanPartnerRecord {
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
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

export interface PulseAdminMembershipAuditContext {
  requestId?: string;
  userAgent?: string;
  ip?: string;
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
  confirmDowngradeToFree?: boolean;
  /**
   * 显式确认把会员降到**更低的付费档位**（如年度 → 月度）。
   * 不确认时只按所选档位追加时长、保持原档位不变。
   */
  confirmDowngradePlan?: boolean;
  /** 本次成交价展示值（元字符串），管理端设置视为一次显式成交并覆盖旧价 */
  priceDisplay?: string;
  /** 本次成交包含的子账号数量（0~10），仅展示与核算 */
  subAccountCount?: number;
  /** 本次成交的子账号加价展示值（元字符串），参与续费定价 */
  subAccountAmountDisplay?: string;
  /**
   * 本次设置的「期数」（管理端弹窗的 × 1 / × 2 / × 3 / × 6 / × 12）。
   *
   * 时长与新客额度都按它叠加：年度 × 2 = 730 天、300 × 2 = 600 位新客。
   * 永久会员没有「期」的概念，固定 1 期；不传 / 非法值按 1 期处理。
   */
  multiplier?: number;
  /**
   * 本次设置是否计入收入。
   *
   * 勾选 → 按**所选档位**落一条 paid 订单（渠道 admin），计入平台营收；
   * 金额优先取成交价，未填则回落到所选档位的配置价；
   * 不勾选 → 按赠送处理，订单金额落 0、渠道 gift，被营收统计排除，
   * 仅在「设置会员等级记录」里标注「赠送」。
   *
   * 与是否降档无关：被「只升不降」抬回原档位、只追加时长时同样有效，
   * 订单记的是所选档位（如月度会员的钱），不是被抬回的那个高档位。
   */
  countAsIncome?: boolean;
  actionSource?: string;
  auditContext?: PulseAdminMembershipAuditContext;
}

/**
 * 补录存量门店的子账号加价。
 *
 * 这些门店成交时还没拆分口径，成交总额本身是对的，缺的只是
 * 「子账号那部分值多少」这一个分量——补录后配置价上涨才能正确传导。
 * 只动子账号字段，绝不改写成交总额。
 */
export interface PulseAdminSubAccountAmountBackfillInput {
  /** 目标档位：哪张成交记录要补录 */
  planId: PulseMembershipPlanId;
  /** 子账号加价展示值（元字符串）；不传或传 null 表示撤销补录 */
  subAccountAmountDisplay?: string | null;
  /** 子账号数量；不传或传 null 表示一并清空 */
  subAccountCount?: number | null;
}

/**
 * 会员成交价预览结果（Pulse 管理端「设置会员等级」弹窗）。
 *
 * 所有金额一律是**后端算好的展示字符串**。前端不做任何乘除、也不做分转元，
 * 避免「运营看到的价 ≠ 实际写入的价」。
 */
export interface PulseAdminPricingPreviewResult {
  /** 本次预览的目标档位；免费会员为 null */
  targetPlanId: PulseMembershipPlanId | null;
  /** 当前配置价（不含子账号） */
  configPriceDisplay: string;
  /** 参与定价的子账号加价：本次输入优先，未填时沿用已录入值 */
  subAccountAmountDisplay: string;
  /** ★ 下次续费价 = 配置价 + 子账号加价 */
  renewalPriceDisplay: string;
  /**
   * 本次填写的成交金额（仅记账回显）。
   *
   * 成交价**不参与**续费定价，运营议出的价格只对本次生效，
   * 未来续费一律按「配置价 + 子账号加价」。
   */
  dealPriceDisplay: string | null;
}

export interface PulseAdminStatusMutationInput {
  userId?: string;
  memberId?: string;
  id?: string;
  status?: PulseMemberStatusValue;
  memberStatus?: PulseMemberStatusValue;
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

export interface PulseMembershipAdjustmentInput {
  delta?: number;
  amount?: number;
  direction?: 'add' | 'subtract' | 'deduct' | 'reduce';
  reason: string;
}
