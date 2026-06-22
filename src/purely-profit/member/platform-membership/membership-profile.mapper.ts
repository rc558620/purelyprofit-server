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

const STORE_INVITE_CODE_ALPHABET = '0123456789';
const STORE_INVITE_QR_CODE_BASE_URL =
  'https://api.qrserver.com/v1/create-qr-code/';
const STORE_INVITE_QR_CODE_SIZE = 240;
const STORE_SCAN_CODE_INVITE_CODE_QUERY_KEYS = [
  'inviteCode',
  'code',
  'invite_code',
];
const STORE_SCAN_CODE_STORE_ID_QUERY_KEYS = ['storeId', 'store_id'];

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
    inviteCode: buildStoreInviteCode(profile.storeId),
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
    avatarUrl: partner.store?.owner?.avatar ?? undefined,
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

export function buildStoreInviteCode(storeId: number): string {
  let seed = storeId * 1103515245 + 12345;
  let inviteCode = '';

  for (let index = 0; index < 6; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    inviteCode +=
      STORE_INVITE_CODE_ALPHABET[seed % STORE_INVITE_CODE_ALPHABET.length];
  }

  return inviteCode;
}

export function buildStoreInviteQrCodeImageUrl(storeId: number): string {
  return buildInviteCodeQrCodeImageUrl(buildStoreInviteCode(storeId));
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

  for (const queryKey of STORE_SCAN_CODE_STORE_ID_QUERY_KEYS) {
    const storeId = normalizeStoreIdCandidate(
      parsedUrl.searchParams.get(queryKey),
    );
    if (storeId !== null) {
      return buildStoreInviteCode(storeId);
    }
  }

  const lastPathSegment = parsedUrl.pathname.split('/').filter(Boolean).at(-1);
  const inviteCodeFromPath = normalizeInviteCodeCandidate(lastPathSegment);
  if (inviteCodeFromPath) {
    return inviteCodeFromPath;
  }

  const storeIdFromPath = normalizeStoreIdCandidate(lastPathSegment);
  if (storeIdFromPath !== null) {
    return buildStoreInviteCode(storeIdFromPath);
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

function normalizeStoreIdCandidate(
  value: string | null | undefined,
): number | null {
  const normalizedValue = value?.trim();
  if (!normalizedValue || !/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const storeId = Number.parseInt(normalizedValue, 10);
  return Number.isSafeInteger(storeId) && storeId > 0 ? storeId : null;
}

function tryParseScanCodeUrl(scanCode: string): URL | null {
  try {
    return new URL(scanCode);
  } catch {
    return null;
  }
}
