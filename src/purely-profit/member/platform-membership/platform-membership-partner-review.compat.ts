import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';

export type PartnerReviewCompatStatus = 'pending' | 'approved' | 'rejected';

export interface PartnerReviewCompatItem {
  id: string;
  name: string;
  phone: string;
  city: string;
  appliedAt: number;
  reason: string;
  avatar: string;
  status: PartnerReviewCompatStatus;
}

export interface PartnerReviewCompatResponse {
  applications: PartnerReviewCompatItem[];
  stats: {
    totalCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
}

function normalizePartnerReviewStatus(
  status: PlatformMembershipPartnerProfileResponseDto['applications'][number]['status'],
): PartnerReviewCompatStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function resolvePartnerReviewCity(region?: string[]): string {
  if (!region || region.length === 0) {
    return '';
  }

  if (region.length >= 2) {
    return region[1] ?? region[0] ?? '';
  }

  return region[0] ?? '';
}

function buildPartnerReviewApplications(
  profile: PlatformMembershipPartnerProfileResponseDto,
): PartnerReviewCompatItem[] {
  return profile.applications.map((application) => ({
    id: application.id,
    name: application.name,
    phone: application.phone,
    city: resolvePartnerReviewCity(application.region),
    appliedAt: application.createdAt,
    reason: application.applyReason ?? '',
    avatar: application.name.slice(0, 1) || '合',
    status: normalizePartnerReviewStatus(application.status),
  }));
}

export function buildPartnerReviewResponse(
  profile: PlatformMembershipPartnerProfileResponseDto,
): PartnerReviewCompatResponse {
  const applications = buildPartnerReviewApplications(profile);
  const pendingCount = applications.filter(
    (application) => application.status === 'pending',
  ).length;
  const approvedCount = applications.filter(
    (application) => application.status === 'approved',
  ).length;
  const rejectedCount = applications.filter(
    (application) => application.status === 'rejected',
  ).length;

  return {
    applications,
    stats: {
      totalCount: applications.length,
      pendingCount,
      approvedCount,
      rejectedCount,
    },
  };
}

export function resolvePartnerReviewRejectReason(
  body?: Record<string, unknown>,
): string {
  const reason = body?.reason;
  if (typeof reason === 'string' && reason.trim() !== '') {
    return reason.trim();
  }

  return '审核未通过';
}
