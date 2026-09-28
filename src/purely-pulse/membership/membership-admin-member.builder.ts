import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import {
  MEMBER_ONLINE_WINDOW_MS,
  PURCHASE_BONUS_POINTS,
} from './membership.constants';
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
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
  toPulseMemberLevel,
} from './membership-admin-query.helper';
import { Money } from '../../shared/money.utils';
import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import type { LockedPriceSnapshot } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';

type PulseAdminLogStoreRecord = Pick<
  PulseAdminStoreIdentityRecord,
  'name' | 'contactPhone' | 'owner'
>;

type PulseAdminLogOwnerRecord = {
  email: string | null;
  name: string | null;
  realName: string | null;
  avatar: string | null;
  wechatPhone: string | null;
};

type PulseAdminPointsLogRecord = {
  id: number;
  storeId: number;
  source: 'purchase_bonus' | 'deduct_payment' | 'admin_adjust' | 'expire';
  changeType: 'increase' | 'decrease';
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
  store: PulseAdminStoreRecord & { deletedAt?: Date | null };
  profile: PulseAdminMembershipProfileRecord | null;
  orderSummary: PulseAdminMemberOrderSummary | undefined;
  partner: PulseAdminPartnerRecord | null;
  banReason: string | null;
}

interface BuildPulseAdminMemberDetailInput {
  store: PulseAdminStoreRecord & { deletedAt?: Date | null };
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  /** 首购锁定价快照（空数组表示未锁价） */
  lockedPrices: LockedPriceSnapshot[];
  /** 各档位当前配置价（分）：折算「配置价 + 子账号加价 = 续费价」用 */
  planPrices: Map<string, number>;
  banReason: string | null;
}

export function buildPulseAdminPointsLogItem(
  log: PulseAdminPointsLogRecord,
): PulseAdminMemberPointsLogsResponseDto['items'][number] {
  const userName = resolveAdminMemberDisplayName(log.store);
  const userPhone = resolveAdminMemberPhone(log.store);

  const signedAmount =
    log.changeType === 'decrease' ? -log.changeAmount : log.changeAmount;

  return {
    id: String(log.id),
    userId: String(log.storeId),
    userName,
    userPhone,
    avatarUrl: log.store.owner.avatar ?? undefined,
    amount: signedAmount,
    type:
      log.source === 'expire'
        ? 'expire'
        : log.changeType === 'increase'
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
  const userPhone = resolveAdminMemberPhone(log.store);

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

/**
 * 是否「在线」：只看账号最近一次鉴权请求，不看展示用的兜底值。
 *
 * ⚠️ 不能用 `lastActiveAt` 的展示兜底（最近充值时间 / 门店更新时间）判断，
 * 否则「刚充过值但没登录」会被误判为在线。
 */
function resolveMemberOnline(
  lastActiveAt: Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastActiveAt) {
    return false;
  }

  return nowMs - lastActiveAt.getTime() <= MEMBER_ONLINE_WINDOW_MS;
}

export function buildPulseAdminMemberListItem(
  input: BuildPulseAdminMemberListItemInput,
): PulseMemberListItemDto {
  const { store, profile, orderSummary, partner, banReason } = input;
  const ownerName = resolveAdminMemberDisplayName(store);
  const phone = resolveAdminMemberPhone(store);
  const isCancelled = Boolean(store.deletedAt);
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
    status: isCancelled
      ? 'cancelled'
      : isBanned
        ? 'banned'
        : isActive
          ? 'active'
          : 'inactive',
    level: toPulseMemberLevel(
      profile?.currentPlanId ?? null,
      profile?.expiresAt ?? null,
    ),
    availablePoints: profile?.availablePoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged: orderSummary?.totalRecharged ?? 0,
    totalRechargedDisplay: Money.fromDbCents(orderSummary?.totalRecharged ?? 0)
      .toFixedOutputYuan()
      .replace(/\.00$/, ''),
    registeredAt: store.createdAt.getTime(),
    lastActiveAt:
      store.owner.lastActiveAt?.getTime() ??
      orderSummary?.lastPaidAt ??
      store.updatedAt.getTime(),
    isOnline: resolveMemberOnline(store.owner.lastActiveAt),
    subAccountEligible:
      (profile?.currentPlanId ?? null) === 'yearly' ||
      (profile?.currentPlanId ?? null) === 'lifetime',
    subAccountQuota: profile?.pulseSubAccountQuota ?? 0,
    subAccountCapabilityEnabled: (profile?.pulseSubAccountQuota ?? 0) > 0,
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
    lockedPrices,
    planPrices,
    banReason,
  } = input;
  // 按渠道拆两组：wechat = 商家端充值；admin / gift = 管理端设置会员等级
  const rechargeOrders = paidOrders.filter(
    (order) => order.paymentChannel === 'wechat',
  );
  const adminGrantOrders = paidOrders.filter(
    (order) => order.paymentChannel !== 'wechat',
  );
  const ownerName = resolveAdminMemberDisplayName(store);
  const phone = resolveAdminMemberPhone(store);
  const currentPlanId = profile?.currentPlanId ?? null;
  const level = toPulseMemberLevel(currentPlanId, profile?.expiresAt ?? null);
  const membershipExpiry = profile?.expiresAt?.getTime() ?? null;
  const isCancelled = Boolean(store.deletedAt);
  const isBanned = Boolean(banReason);
  const isActive = isPulseMemberActive(profile);
  const registeredAt = store.createdAt.getTime();
  // 兜底只认商家端充值：后台设置会员等级是平台侧动作，
  // 用它当「最近活跃」会让一次后台操作把会员刷成刚活跃
  const lastActiveAt =
    store.owner.lastActiveAt?.getTime() ??
    rechargeOrders[0]?.createdAt.getTime() ??
    store.updatedAt.getTime();
  // 「累计充值」只统计商家端真实充值：后台设置会员等级（admin / gift）属于
  // 平台侧操作，单独由 adminGrantHistory / 营收看板承载，不混进会员的充值口径
  const totalRecharged = Money.sum(
    rechargeOrders.map((order) => Money.fromDbCents(order.amount)),
  ).toDbCents();

  return {
    id: String(store.id),
    name: ownerName,
    phone,
    avatarChar: ownerName.slice(0, 1) || '会',
    avatarColorIdx: store.id % 6,
    avatarUrl: store.owner.avatar ?? '',
    status: isCancelled
      ? 'cancelled'
      : isBanned
        ? 'banned'
        : isActive
          ? 'active'
          : 'inactive',
    level,
    registeredAt,
    lastActiveAt,
    availablePoints: profile?.availablePoints ?? 0,
    totalPointsEarned: profile?.totalPoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged,
    totalRechargedDisplay: Money.fromDbCents(totalRecharged)
      .toFixedOutputYuan()
      .replace(/\.00$/, ''),
    rechargeCount: rechargeOrders.length,
    invitedCount: promoCount,
    rechargeHistory: rechargeOrders.map((order) => ({
      id: String(order.id),
      planName: order.planName,
      amount: Money.fromDbCents(order.amount).toDbCents(),
      amountDisplay: Money.fromDbCents(order.amount)
        .toFixedOutputYuan()
        .replace(/\.00$/, ''),
      pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
      channel: 'wechat' as const,
      createdAt: order.createdAt.getTime(),
    })),
    // 「设置会员等级记录」：admin=勾选了计入收入（显示金额）；gift=赠送（显示「赠送」）
    adminGrantCount: adminGrantOrders.length,
    adminGrantHistory: adminGrantOrders.map((order) => ({
      id: String(order.id),
      planName: order.planName,
      amount: Money.fromDbCents(order.amount).toDbCents(),
      amountDisplay:
        order.paymentChannel === 'gift'
          ? '赠送'
          : Money.fromDbCents(order.amount)
              .toFixedOutputYuan()
              .replace(/\.00$/, ''),
      pointsAwarded: 0,
      channel:
        order.paymentChannel === 'gift'
          ? ('gift' as const)
          : ('admin' as const),
      createdAt: order.createdAt.getTime(),
    })),
    remark: banReason ?? `${store.name} 的平台会员档案`,
    membershipExpiry,
    isOnline: resolveMemberOnline(store.owner.lastActiveAt),
    // 成交价快照：让运营看得到「当前是什么价、子账号加价补录了没有」，
    // 而不只是一个重置按钮。subAccountAmountDisplay 为 null 即提示需要补录。
    lockedPrices: lockedPrices.map((item) => ({
      planId: item.planId,
      price: item.price,
      priceDisplay: Money.fromDbCents(item.price)
        .toFixedOutputYuan()
        .replace(/\.00$/, ''),
      // 用 typeof 兜底：缺少该列的行（旧数据 / mock 残行）值为 undefined，
      // `=== null` 判断会漏过去并把 undefined 交给金额格式化
      subAccountAmountDisplay:
        typeof item.subAccountAmount === 'number'
          ? Money.fromDbCents(item.subAccountAmount)
              .toFixedOutputYuan()
              .replace(/\.00$/, '')
          : null,
      subAccountCount:
        typeof item.subAccountCount === 'number' ? item.subAccountCount : null,
      // 续费价 = 当前配置价 + 子账号加价（仅当该档位录了加价时下发），
      // 供管理端快照展示「加价 ¥100 = ¥498」。
      //
      // ⚠️ 必须过 isSubAccountPricingPlan：月 / 季开不了子账号，`resolvePlanPrice`
      // 也不计它们的加价，这里带上就会显示一个客户永远付不到的价格
      renewalPriceDisplay:
        typeof item.subAccountAmount === 'number' &&
        planPrices.has(item.planId) &&
        isSubAccountPricingPlan(item.planId)
          ? Money.fromDbCents(
              (planPrices.get(item.planId) ?? 0) + item.subAccountAmount,
            )
              .toFixedOutputYuan()
              .replace(/\.00$/, '')
          : null,
      source: item.source,
      lockedAt: item.lockedAt.getTime(),
    })),
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
