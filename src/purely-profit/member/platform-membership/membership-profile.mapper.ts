import type {
  PlatformMembershipApprovedPartnerDto,
  PlatformMembershipProfileResponseDto,
} from './dto/platform-membership-response.dto';
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
};

export function buildProfileResponse(
  profile: StoreMembershipProfileRecord,
  partners: StorePartnerRecord[],
): PlatformMembershipProfileResponseDto {
  const primaryPartner = partners[0] ?? null;

  return {
    memberInfo: buildMembershipInfo(profile),
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(partners),
  };
}

export function buildMembershipInfo(
  profile: StoreMembershipProfileRecord,
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
    inviteCode: buildInviteCode(profile.storeId),
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
    ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
    beanBalance: partner.beanBalance,
    totalEarnedBeans: partner.totalEarnedBeans,
    totalWithdrawnBeans: partner.totalWithdrawnBeans,
  };
}

export function buildApprovedPartnersResponse(
  partners: ApprovedPartnerLike[],
): PlatformMembershipApprovedPartnerDto[] {
  return partners
    .filter((partner) => partner.status === 'approved')
    .map((partner) => ({
      id: String(partner.id),
      name: partner.name ?? '',
      phone: partner.phone ?? '',
      ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    }));
}

function buildInviteCode(storeId: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let seed = storeId * 1103515245 + 12345;
  let inviteCode = '';

  for (let index = 0; index < 6; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    inviteCode += alphabet[seed % alphabet.length];
  }

  return inviteCode;
}
