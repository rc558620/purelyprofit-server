import { PartnerWithdrawalStatus } from '@prisma/client';
import type {
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
} from './dto/pulse-growth-admin.dto';
import type {
  AdminPartnerApplicationRecord,
  AdminPartnerApplicationStats,
  AdminPayoutRecord,
  AdminPayoutStats,
} from './growth-admin.query';
import {
  formatDateTime,
  maskPhone,
  resolveRegionCity,
} from './growth-admin.shared';

type AdminPayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected';

type AdminPartnerApplicationItem = {
  id: string;
  name: string;
  phone: string;
  city: string;
  appliedAt: string;
  reason: string;
  avatar: string;
  status: 'pending' | 'approved' | 'rejected';
};

type AdminPayoutItem = {
  id: string;
  partnerName: string;
  partnerPhone: string;
  partnerCity: string;
  amount: number;
  accountType: AdminPayoutRecord['accountType'];
  accountNo: string;
  accountName: string;
  status: AdminPayoutStatus;
  appliedAt: string;
  paidAt: string | null;
  rejectReason: string | null;
};

export function buildAdminPartnerApplicationsResponse(input: {
  applications: AdminPartnerApplicationRecord[];
  stats: AdminPartnerApplicationStats;
  limit?: number;
}): PulseAdminPartnerApplicationsResponseDto {
  const hasMore =
    input.limit !== undefined && input.applications.length > input.limit;
  const visibleApplications = hasMore
    ? input.applications.slice(0, input.limit)
    : input.applications;

  return {
    items: visibleApplications.map((application) =>
      mapAdminPartnerApplication(application),
    ),
    pendingCount: input.stats.pendingCount,
    approvedCount: input.stats.approvedCount,
    rejectedCount: input.stats.rejectedCount,
    hasMore,
    nextCursor: hasMore
      ? encodeAdminPartnerApplicationsCursor(visibleApplications.at(-1) ?? null)
      : null,
  };
}

export function parseAdminPartnerApplicationsCursor(
  cursor: string,
): { createdAt: Date; id: number } | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }

  const [, rawCreatedAt, rawId] = match;
  const createdAtMs = Number(rawCreatedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    createdAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    createdAt: new Date(createdAtMs),
    id,
  };
}

export function encodeAdminPartnerApplicationsCursor(
  application: Pick<AdminPartnerApplicationRecord, 'createdAt' | 'id'> | null,
): string | null {
  if (!application) {
    return null;
  }

  return `${application.createdAt.getTime()}_${application.id}`;
}

export function buildAdminPayoutsResponse(input: {
  withdrawals: AdminPayoutRecord[];
  stats: AdminPayoutStats;
  limit?: number;
}): PulseAdminPayoutsResponseDto {
  const hasMore =
    input.limit !== undefined && input.withdrawals.length > input.limit;
  const visibleWithdrawals = hasMore
    ? input.withdrawals.slice(0, input.limit)
    : input.withdrawals;

  return {
    items: visibleWithdrawals.map((withdrawal) =>
      mapAdminPayoutItem(withdrawal),
    ),
    pendingCount: input.stats.pendingCount,
    pendingTotal: input.stats.pendingTotal,
    paidTotal: input.stats.paidTotal,
    hasMore,
    nextCursor: hasMore
      ? encodeAdminPayoutsCursor(visibleWithdrawals.at(-1) ?? null)
      : null,
  };
}

export function parseAdminPayoutsCursor(
  cursor: string,
): { appliedAt: Date; id: number } | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }

  const [, rawAppliedAt, rawId] = match;
  const appliedAtMs = Number(rawAppliedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(appliedAtMs) ||
    !Number.isSafeInteger(id) ||
    appliedAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    appliedAt: new Date(appliedAtMs),
    id,
  };
}

export function encodeAdminPayoutsCursor(
  payout: Pick<AdminPayoutRecord, 'appliedAt' | 'id'> | null,
): string | null {
  if (!payout) {
    return null;
  }

  return `${payout.appliedAt.getTime()}_${payout.id}`;
}

function mapAdminPartnerApplication(
  application: AdminPartnerApplicationRecord,
): AdminPartnerApplicationItem {
  return {
    id: String(application.id),
    name: application.name,
    phone: maskPhone(application.phone),
    city: resolveRegionCity(application.region),
    appliedAt: formatDateTime(application.createdAt),
    reason: application.applyReason?.trim() || '暂无申请理由',
    avatar: application.name.trim().slice(0, 1) || '合',
    status: normalizePartnerApplicationStatus(application.status),
  };
}

function normalizePartnerApplicationStatus(
  status: string,
): AdminPartnerApplicationItem['status'] {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function mapAdminPayoutItem(withdrawal: AdminPayoutRecord): AdminPayoutItem {
  return {
    id: String(withdrawal.id),
    partnerName: withdrawal.partner.name?.trim() || '未命名合伙人',
    partnerPhone: maskPhone(withdrawal.partner.phone ?? ''),
    partnerCity: resolveRegionCity(withdrawal.partner.region),
    amount: withdrawal.rmbAmount,
    accountType: withdrawal.accountType,
    accountNo: withdrawal.accountNo,
    accountName: withdrawal.accountName,
    status: normalizeAdminPayoutStatus(withdrawal.status),
    appliedAt: formatDateTime(withdrawal.appliedAt),
    paidAt: withdrawal.paidAt ? formatDateTime(withdrawal.paidAt) : null,
    rejectReason: withdrawal.rejectReason,
  };
}

function normalizeAdminPayoutStatus(
  status: PartnerWithdrawalStatus,
): AdminPayoutItem['status'] {
  switch (status) {
    case PartnerWithdrawalStatus.approved:
      return 'approved';
    case PartnerWithdrawalStatus.paid:
      return 'paid';
    case PartnerWithdrawalStatus.rejected:
      return 'rejected';
    default:
      return 'pending';
  }
}
