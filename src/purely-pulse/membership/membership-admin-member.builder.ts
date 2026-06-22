import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type {
  PulseMemberDetailDto,
  PulseMemberListItemDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PURCHASE_BONUS_POINTS } from './membership.constants';
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreIdentityRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountDetail,
} from './membership.types';

/**
 * 判断会员订阅是否仍处于有效状态。
 *
 * 统一判定逻辑（对齐 isActiveMembership / buildMembershipDto）：
 * - lifetime 计划永不过期
 * - 历史兼容：yearly + null expiresAt → 视为 lifetime
 * - 其他计划正常检查 expiresAt 是否晚于当前时间
 * - 无 profile 或 currentPlanId 为空 → inactive
 */
function isPulseMemberActive(
  profile: PulseAdminMembershipProfileRecord | null,
): boolean {
  if (!profile?.currentPlanId) {
    return false;
  }

  if (profile.currentPlanId === 'lifetime') {
    return true;
  }

  // 历史兼容：yearly + null expiresAt → 视为 lifetime
  if (profile.currentPlanId === 'yearly' && profile.expiresAt === null) {
    return true;
  }

  if (!profile.expiresAt) {
    return false;
  }

  return profile.expiresAt > new Date();
}
import {
  maskAdminMemberPhone,
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
  toPulseMemberLevel,
} from './membership-admin-query.helper';

type PulseAdminLogStoreRecord = Pick<
  PulseAdminStoreIdentityRecord,
  'name' | 'contactPhone' | 'owner'
>;

type PulseAdminLogOwnerRecord = {
  email: string | null;
  name: string | null;
  realName: string | null;
  avatar: string | null;
};

type PulseAdminPointsLogRecord = {
  id: number;
  storeId: number;
  source: 'purchase_bonus' | 'deduct_payment' | 'admin_adjust' | 'expire';
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
  store: PulseAdminLogStoreRecord & { owner: PulseAdminLogOwnerRecord };
};

type PulseAdminBeanLogRecord = {
  id: number;
  storeId: number;
  source: 'promo_reward' | 'deduct_payment' | 'withdrawal' | 'admin_adjust';
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  createdAt: Date;
  store: PulseAdminLogStoreRecord & { owner: PulseAdminLogOwnerRecord };
};

interface BuildPulseAdminMemberListItemInput {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  orderSummary: PulseAdminMemberOrderSummary | undefined;
  partner: PulseAdminPartnerRecord | null;
  banReason: string | null;
}

interface BuildPulseAdminMemberDetailInput {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  banReason: string | null;
}

export function buildPulseAdminPointsLogItem(
  log: PulseAdminPointsLogRecord,
): PulseAdminMemberPointsLogsResponseDto['items'][number] {
  const userName = resolveAdminMemberDisplayName(log.store);
  const userPhone = maskAdminMemberPhone(resolveAdminMemberPhone(log.store));

  return {
    id: String(log.id),
    userId: String(log.storeId),
    userName,
    userPhone,
    avatarUrl: log.store.owner.avatar ?? undefined,
    amount: log.changeAmount,
    type:
      log.source === 'expire'
        ? 'expire'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend',
    source: log.source,
    description: log.description,
    createdAt: log.createdAt.getTime(),
    expireAt: log.expireAt ? log.expireAt.getTime() : null,
  };
}

export function buildPulseAdminBeanLogItem(
  log: PulseAdminBeanLogRecord,
): PulseAdminMemberBeanLogsResponseDto['items'][number] {
  const userName = resolveAdminMemberDisplayName(log.store);
  const userPhone = maskAdminMemberPhone(resolveAdminMemberPhone(log.store));

  return {
    id: String(log.id),
    userId: String(log.storeId),
    userName,
    userPhone,
    avatarUrl: log.store.owner.avatar ?? undefined,
    amount: log.changeAmount,
    type:
      log.source === 'withdrawal'
        ? 'withdraw'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend',
    source: log.source,
    description: log.description,
    relatedPromoId: log.relatedPromoRecordId
      ? String(log.relatedPromoRecordId)
      : undefined,
    relatedUser: log.relatedUser ?? undefined,
    createdAt: log.createdAt.getTime(),
  };
}

export function buildPulseAdminMemberListItem(
  input: BuildPulseAdminMemberListItemInput,
): PulseMemberListItemDto {
  const { store, profile, orderSummary, partner, banReason } = input;
  const ownerName = resolveAdminMemberDisplayName(store);
  const phone = resolveAdminMemberPhone(store);
  const isBanned = Boolean(banReason);
  const isActive = isPulseMemberActive(profile);
  const membershipExpiry = profile?.expiresAt?.getTime() ?? null;

  return {
    id: String(store.id),
    name: ownerName,
    phone,
    avatarChar: ownerName.slice(0, 1) || '会',
    avatarColorIdx: store.id % 6,
    avatarUrl: store.owner.avatar ?? '',
    status: isBanned ? 'banned' : isActive ? 'active' : 'inactive',
    level: toPulseMemberLevel(
      profile?.currentPlanId ?? null,
      profile?.expiresAt ?? null,
    ),
    availablePoints: profile?.availablePoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged: orderSummary?.totalRecharged ?? 0,
    registeredAt: store.createdAt.getTime(),
    lastActiveAt:
      store.owner.lastActiveAt?.getTime() ??
      orderSummary?.lastPaidAt ??
      store.updatedAt.getTime(),
    subAccountEligible:
      (profile?.currentPlanId ?? null) === 'yearly' ||
      (profile?.currentPlanId ?? null) === 'lifetime',
    subAccountQuota: profile?.subAccountQuota ?? 0,
    subAccountCapabilityEnabled: (profile?.subAccountQuota ?? 0) > 0,
    membershipExpiry,
  } satisfies PulseMemberListItemDto;
}

export function buildPulseAdminMemberDetail(
  input: BuildPulseAdminMemberDetailInput,
): PulseMemberDetailDto {
  const {
    store,
    profile,
    paidOrders,
    partner,
    promoCount,
    subAccountSummary,
    banReason,
  } = input;
  const ownerName = resolveAdminMemberDisplayName(store);
  const phone = resolveAdminMemberPhone(store);
  const currentPlanId = profile?.currentPlanId ?? null;
  const level = toPulseMemberLevel(currentPlanId, profile?.expiresAt ?? null);
  const membershipExpiry = profile?.expiresAt?.getTime() ?? null;
  const isBanned = Boolean(banReason);
  const isActive = isPulseMemberActive(profile);
  const registeredAt = store.createdAt.getTime();
  const lastActiveAt =
    store.owner.lastActiveAt?.getTime() ??
    paidOrders[0]?.createdAt.getTime() ??
    store.updatedAt.getTime();
  const totalRecharged = paidOrders.reduce(
    (sum, order) => sum + order.amount,
    0,
  );

  return {
    id: String(store.id),
    name: ownerName,
    phone,
    avatarChar: ownerName.slice(0, 1) || '会',
    avatarColorIdx: store.id % 6,
    avatarUrl: store.owner.avatar ?? '',
    status: isBanned ? 'banned' : isActive ? 'active' : 'inactive',
    level,
    registeredAt,
    lastActiveAt,
    availablePoints: profile?.availablePoints ?? 0,
    totalPointsEarned: profile?.totalPoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged,
    rechargeCount: paidOrders.length,
    invitedCount: promoCount,
    rechargeHistory: paidOrders.map((order) => ({
      id: String(order.id),
      planName: order.planName,
      amount: order.amount,
      pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
      channel: 'wechat',
      createdAt: order.createdAt.getTime(),
    })),
    remark: banReason ?? `${store.name} 的平台会员档案`,
    membershipExpiry,
    subAccountEligible: subAccountSummary.eligible,
    subAccountQuota: subAccountSummary.quota,
    subAccountCapabilityEnabled: subAccountSummary.enabled,
    subAccountQuotaMax: subAccountSummary.quotaMax,
    subAccountsUsedCount: subAccountSummary.usedCount,
    subAccountsAvailableCount: subAccountSummary.availableCount,
    subAccountRoleSummary: subAccountSummary.roleSummary.map((item) => ({
      role: item.role as 'cashier' | 'finance' | 'manager',
      activeCount: item.activeCount,
      inactiveCount: item.inactiveCount,
      disabledCount: item.disabledCount,
      assignedCount: item.assignedCount,
    })),
    subAccountSlots: subAccountSummary.slots.map((slot) => ({
      id: String(slot.id),
      slotIndex: slot.slotIndex,
      role: slot.role as 'cashier' | 'finance' | 'manager',
      status: slot.status as 'active' | 'inactive' | 'disabled',
      isAssigned: slot.isAssigned,
      employeeId: slot.employeeId ? String(slot.employeeId) : null,
      employeeName: slot.employeeName,
      canAccessHome: slot.canAccessHome,
      canUseHandover: slot.canUseHandover,
    })),
    subAccountCapability: {
      subAccountQuota: subAccountSummary.quota,
      subAccountEligible: subAccountSummary.eligible,
      subAccountCapabilityEnabled: subAccountSummary.enabled,
      subAccountQuotaMax: subAccountSummary.quotaMax,
      subAccountsUsedCount: subAccountSummary.usedCount,
      subAccountsAvailableCount: subAccountSummary.availableCount,
      subAccountRoleSummary: subAccountSummary.slots.map((slot) => ({
        slot: slot.slotIndex,
        role: slot.role as 'cashier' | 'finance' | 'manager',
        status: slot.status as 'active' | 'inactive' | 'disabled',
        isAssigned: slot.isAssigned,
      })),
    },
  };
}
