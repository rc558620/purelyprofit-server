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
  store?: { owner: { avatar: string | null } } | null;
};

const STORE_INVITE_QR_CODE_BASE_URL =
  'https://api.qrserver.com/v1/create-qr-code/';
const STORE_INVITE_QR_CODE_SIZE = 240;
const STORE_SCAN_CODE_INVITE_CODE_QUERY_KEYS = [
  'inviteCode',
  'code',
  'invite_code',
];

export function buildProfileResponse(
  profile: StoreMembershipProfileRecord,
  partners: StorePartnerRecord[],
  inviteCode: string | null = null,
): PlatformMembershipProfileResponseDto {
  const primaryPartner = partners[0] ?? null;

  return {
    memberInfo: buildMembershipInfo(profile, inviteCode),
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(partners),
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

export function buildInviteCodeQrCodeImageUrl(inviteCode: string): string {
  const params = new URLSearchParams({
    size: `${STORE_INVITE_QR_CODE_SIZE}x${STORE_INVITE_QR_CODE_SIZE}`,
    format: 'png',
    margin: '0',
    data: inviteCode,
  });

  return `${STORE_INVITE_QR_CODE_BASE_URL}?${params.toString()}`;
}

export function resolveInviteCodeFromClubStoreScanCode(
  scanCode: string,
): string | null {
  const normalizedScanCode = scanCode.trim();
  if (!normalizedScanCode) {
    return null;
  }

  const directInviteCode = normalizeInviteCodeCandidate(normalizedScanCode);
  if (directInviteCode) {
    return directInviteCode;
  }

  const parsedUrl = tryParseScanCodeUrl(normalizedScanCode);
  if (!parsedUrl) {
    return null;
  }

  for (const queryKey of STORE_SCAN_CODE_INVITE_CODE_QUERY_KEYS) {
    const inviteCode = normalizeInviteCodeCandidate(
      parsedUrl.searchParams.get(queryKey),
    );
    if (inviteCode) {
      return inviteCode;
    }
  }

  // storeId 参数不再支持直接转换为邀请码（已改为持久化邀请码表，不可本地计算）

  const lastPathSegment = parsedUrl.pathname.split('/').filter(Boolean).at(-1);
  const inviteCodeFromPath = normalizeInviteCodeCandidate(lastPathSegment);
  if (inviteCodeFromPath) {
    return inviteCodeFromPath;
  }

  return null;
}

function normalizeInviteCodeCandidate(
  value: string | null | undefined,
): string | null {
  const normalizedValue = value?.trim().toUpperCase();
  if (!normalizedValue) {
    return null;
  }

  return /^[A-Z0-9]{6,32}$/.test(normalizedValue) ? normalizedValue : null;
}

function tryParseScanCodeUrl(scanCode: string): URL | null {
  try {
    return new URL(scanCode);
  } catch {
    // 非合法 URL，返回 null
    return null;
  }
}
