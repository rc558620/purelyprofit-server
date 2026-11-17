import { Money } from '../../shared/money.utils';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import {
  buildAdminGrantHistoryItems,
  buildLockedPriceItems,
  buildRechargeHistoryItems,
  buildRenewalPriceAdjustHistoryItems,
  buildSubAccountFields,
  buildSubAccountQuotaHistoryItems,
} from './membership-admin-member-detail-sections.builder';
import { formatAdminMemberFenDisplay } from './membership-admin-money.utils';
import {
  resolveAdminMemberStatus,
  resolveMemberOnline,
} from './membership-admin-member-presence.utils';
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
  toPulseMemberLevel,
} from './membership-admin-query.helper';
import type { PulseAdminMemberDetailSnapshot } from './membership-admin-member-read.types';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreRecord,
} from './membership.types';

/**
 * 会员详情：装配结构 → DTO。
 *
 * 只负责编排（拆渠道 → 分组字段），单个 Tab 的行映射见
 * `membership-admin-member-detail-sections.builder`。
 */

type PulseDetailIdentityFields = Pick<
  PulseMemberDetailDto,
  | 'id'
  | 'name'
  | 'phone'
  | 'avatarChar'
  | 'avatarColorIdx'
  | 'avatarUrl'
  | 'status'
  | 'level'
  | 'registeredAt'
  | 'lastActiveAt'
>;

type PulseDetailMembershipFields = Pick<
  PulseMemberDetailDto,
  | 'availablePoints'
  | 'totalPointsEarned'
  | 'beanBalance'
  | 'isPartner'
  | 'totalRecharged'
  | 'totalRechargedDisplay'
  | 'invitedCount'
  | 'remark'
  | 'membershipExpiry'
  | 'isOnline'
>;

type PulseDetailRecordFields = Pick<
  PulseMemberDetailDto,
  | 'rechargeCount'
  | 'rechargeHistory'
  | 'adminGrantCount'
  | 'adminGrantHistory'
  | 'renewalPriceAdjustCount'
  | 'renewalPriceAdjustHistory'
  | 'subAccountQuotaRecordCount'
  | 'subAccountQuotaRecordHistory'
>;

/** 详情页折算用的中间态：一次算好，各分区共用，避免同一字段重复推导 */
interface PulseAdminMemberDetailContext {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  banReason: string | null;
  /** 商家端微信充值（wechat）：计入「累计充值」与充值记录 */
  rechargeOrders: PulseAdminMembershipOrderRecord[];
  /** 管理端设置会员等级（admin / gift）：单独成 Tab，不混进充值口径 */
  adminGrantOrders: PulseAdminMembershipOrderRecord[];
  ownerName: string;
  phone: string;
  level: PulseAdminMemberLevel;
  membershipExpiry: number | null;
  lastActiveAt: number;
  totalRecharged: number;
}

export function buildPulseAdminMemberDetail(
  input: PulseAdminMemberDetailSnapshot,
): PulseMemberDetailDto {
  const context = resolveDetailContext(input);

  return {
    ...buildDetailIdentityFields(context),
    ...buildDetailMembershipFields(context),
    ...buildDetailRecordFields(context, input),
    lockedPrices: buildLockedPriceItems(input.lockedPrices, input.planPrices),
    ...buildSubAccountFields(input.subAccountSummary),
  };
}

function resolveDetailContext(
  input: PulseAdminMemberDetailSnapshot,
): PulseAdminMemberDetailContext {
  const { store, profile, paidOrders, partner, promoCount, banReason } = input;
  // 按渠道拆两组：wechat = 商家端充值；admin / gift = 管理端设置会员等级
  const rechargeOrders = paidOrders.filter(
    (order) => order.paymentChannel === 'wechat',
  );
  const adminGrantOrders = paidOrders.filter(
    (order) => order.paymentChannel !== 'wechat',
  );

  return {
    store,
    profile,
    partner,
    promoCount,
    banReason,
    rechargeOrders,
    adminGrantOrders,
    ownerName: resolveAdminMemberDisplayName(store),
    phone: resolveAdminMemberPhone(store),
    level: toPulseMemberLevel(
      profile?.currentPlanId ?? null,
      profile?.expiresAt ?? null,
    ),
    membershipExpiry: profile?.expiresAt?.getTime() ?? null,
    lastActiveAt: resolveDetailLastActiveAt(store, rechargeOrders),
    totalRecharged: sumRechargeFen(rechargeOrders),
  };
}

/**
 * 「最近活跃」的兜底只认商家端充值：后台设置会员等级是平台侧动作，
 * 用它当兜底会让一次后台操作把会员刷成刚活跃。
 */
function resolveDetailLastActiveAt(
  store: PulseAdminStoreRecord,
  rechargeOrders: PulseAdminMembershipOrderRecord[],
): number {
  return (
    store.owner.lastActiveAt?.getTime() ??
    rechargeOrders[0]?.createdAt.getTime() ??
    store.updatedAt.getTime()
  );
}

/**
 * 「累计充值」只统计商家端真实充值：后台设置会员等级（admin / gift）属于
 * 平台侧操作，单独由 adminGrantHistory / 营收看板承载，不混进充值口径。
 */
function sumRechargeFen(
  rechargeOrders: PulseAdminMembershipOrderRecord[],
): number {
  return Money.sum(
    rechargeOrders.map((order) => Money.fromDbCents(order.amount)),
  ).toDbCents();
}

function buildDetailIdentityFields(
  context: PulseAdminMemberDetailContext,
): PulseDetailIdentityFields {
  const { store, ownerName, phone, level, lastActiveAt, profile, banReason } =
    context;

  return {
    id: String(store.id),
    name: ownerName,
    phone,
    avatarChar: ownerName.slice(0, 1) || '会',
    avatarColorIdx: store.id % 6,
    avatarUrl: store.owner.avatar ?? '',
    status: resolveAdminMemberStatus(store, banReason, profile),
    level,
    registeredAt: store.createdAt.getTime(),
    lastActiveAt,
  };
}

function buildDetailMembershipFields(
  context: PulseAdminMemberDetailContext,
): PulseDetailMembershipFields {
  const {
    store,
    profile,
    partner,
    promoCount,
    banReason,
    totalRecharged,
    membershipExpiry,
  } = context;

  return {
    availablePoints: profile?.availablePoints ?? 0,
    totalPointsEarned: profile?.totalPoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged,
    totalRechargedDisplay: formatAdminMemberFenDisplay(totalRecharged),
    invitedCount: promoCount,
    remark: banReason ?? `${store.name} 的平台会员档案`,
    membershipExpiry,
    isOnline: resolveMemberOnline(store.owner.lastActiveAt),
  };
}

function buildDetailRecordFields(
  context: PulseAdminMemberDetailContext,
  input: PulseAdminMemberDetailSnapshot,
): PulseDetailRecordFields {
  return {
    rechargeCount: context.rechargeOrders.length,
    rechargeHistory: buildRechargeHistoryItems(context.rechargeOrders),
    adminGrantCount: context.adminGrantOrders.length,
    adminGrantHistory: buildAdminGrantHistoryItems(context.adminGrantOrders),
    renewalPriceAdjustCount: input.renewalPriceAdjustments.length,
    renewalPriceAdjustHistory: buildRenewalPriceAdjustHistoryItems(
      input.renewalPriceAdjustments,
    ),
    subAccountQuotaRecordCount: input.subAccountQuotaAudits.length,
    subAccountQuotaRecordHistory: buildSubAccountQuotaHistoryItems(
      input.subAccountQuotaAudits,
    ),
  };
}
