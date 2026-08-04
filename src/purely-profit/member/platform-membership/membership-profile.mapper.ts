import type { PlatformMembershipProfileResponseDto } from './dto/platform-membership-response.dto';
import {
  isMembershipProfileActive,
  resolveFrontendMembershipExpiry,
} from './membership-expiry.utils';
import type {
  StoreMembershipProfileRecord,
  StorePartnerRecord,
} from './platform-membership.types';

type ApprovedPartnerLike = Pick<
  StorePartnerRecord,
  | 'id'
  | 'name'
  | 'phone'
  | 'joinedAt'
  | 'beanBalance'
  | 'totalEarnedBeans'
  | 'totalWithdrawnBeans'
> & {
  status: string;
  store?: { owner: { avatar: string | null } } | null;
};

export function buildProfileResponse(
  profile: StoreMembershipProfileRecord,
  partner: StorePartnerRecord | null,
  inviteCode: string | null = null,
): PlatformMembershipProfileResponseDto {
  const approved = buildApprovedPartnerResponse(partner);

  return {
    memberInfo: buildMembershipInfo(profile, inviteCode),
    approvedPartner: approved,
    approvedPartners: approved ? [approved] : [],
  };
}

export function buildMembershipInfo(
  profile: StoreMembershipProfileRecord,
  inviteCode: string | null = null,
): PlatformMembershipProfileResponseDto['memberInfo'] {
  const expiredAt = resolveFrontendMembershipExpiry(profile)?.getTime() ?? null;
  const isLegacyLifetimeMembership =
    profile.currentPlanId === 'yearly' && profile.expiresAt === null;
  const isActive = isMembershipProfileActive(profile);

  return {
    isActive,
    planId: isActive ? profile.currentPlanId : null,
    ...(isLegacyLifetimeMembership ? { displayPlanName: 'ages会员' } : {}),
    expiredAt,
    inviteCode,
    totalPoints: profile.totalPoints,
    availablePoints: profile.availablePoints,
  };
}

export function buildApprovedPartnerResponse(
  partner: ApprovedPartnerLike | null,
): PlatformMembershipProfileResponseDto['approvedPartner'] {
  if (!partner || partner.status !== 'approved') {
    return null;
  }

  return {
    id: String(partner.id),
    name: partner.name ?? '',
    phone: partner.phone ?? '',
    ...(partner.store?.owner?.avatar
      ? { avatarUrl: partner.store.owner.avatar }
      : {}),
    ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
    beanBalance: partner.beanBalance,
    totalEarnedBeans: partner.totalEarnedBeans,
    totalWithdrawnBeans: partner.totalWithdrawnBeans,
  };
}


