import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
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
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreRecord,
} from './membership.types';

/**
 * 会员列表项：装配结构 → DTO。
 *
 * 详情见 `membership-admin-member-detail.builder`，
 * 积分 / 纯利豆流水见 `membership-admin-member-logs.builder`。
 */

interface BuildPulseAdminMemberListItemInput {
  store: PulseAdminStoreRecord & { deletedAt?: Date | null };
  profile: PulseAdminMembershipProfileRecord | null;
  orderSummary: PulseAdminMemberOrderSummary | undefined;
  partner: PulseAdminPartnerRecord | null;
  banReason: string | null;
  /** 续费价是否被调整过（曾经调过即 true，由调用方按审计 + 当前覆盖价判定） */
  renewalPriceAdjusted: boolean;
}

export function buildPulseAdminMemberListItem(
  input: BuildPulseAdminMemberListItemInput,
): PulseMemberListItemDto {
  const {
    store,
    profile,
    orderSummary,
    partner,
    banReason,
    renewalPriceAdjusted,
  } = input;
  const ownerName = resolveAdminMemberDisplayName(store);
  const phone = resolveAdminMemberPhone(store);
  const currentPlanId = profile?.currentPlanId ?? null;
  const totalRecharged = orderSummary?.totalRecharged ?? 0;

  return {
    id: String(store.id),
    name: ownerName,
    phone,
    avatarChar: ownerName.slice(0, 1) || '会',
    avatarColorIdx: store.id % 6,
    avatarUrl: store.owner.avatar ?? '',
    status: resolveAdminMemberStatus(store, banReason, profile),
    level: toPulseMemberLevel(currentPlanId, profile?.expiresAt ?? null),
    availablePoints: profile?.availablePoints ?? 0,
    beanBalance: partner?.beanBalance ?? 0,
    isPartner: partner?.status === 'approved',
    totalRecharged,
    totalRechargedDisplay: formatAdminMemberFenDisplay(totalRecharged),
    registeredAt: store.createdAt.getTime(),
    lastActiveAt:
      store.owner.lastActiveAt?.getTime() ??
      orderSummary?.lastPaidAt ??
      store.updatedAt.getTime(),
    isOnline: resolveMemberOnline(store.owner.lastActiveAt),
    subAccountEligible:
      currentPlanId === 'yearly' || currentPlanId === 'lifetime',
    subAccountQuota: profile?.pulseSubAccountQuota ?? 0,
    subAccountCapabilityEnabled: (profile?.pulseSubAccountQuota ?? 0) > 0,
    membershipExpiry: profile?.expiresAt?.getTime() ?? null,
    renewalPriceAdjusted,
  } satisfies PulseMemberListItemDto;
}
