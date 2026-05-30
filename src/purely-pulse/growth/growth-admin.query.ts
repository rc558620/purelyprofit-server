import {
  PartnerWithdrawalStatus,
  Prisma,
  type PartnerWithdrawalStatus as PartnerWithdrawalStatusValue,
} from '@prisma/client';
import type { PulsePayoutTabValue } from './dto/pulse-growth.dto';
import type { PrismaService } from '../../prisma/prisma.service';

export interface AdminPartnerApplicationRecord {
  id: number;
  name: string;
  phone: string;
  region: string[];
  applyReason: string | null;
  createdAt: Date;
  status: string;
}

export interface AdminPartnerApplicationAccessRecord {
  id: number;
  storeId: number;
}

export interface AdminPartnerApplicationStats {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface AdminPartnerApplicationCursor {
  createdAt: Date;
  id: number;
}

export interface AdminPartnerApplicationListQueryInput {
  where: Prisma.StorePartnerApplicationWhereInput;
  tab?: 'all' | 'pending' | 'approved' | 'rejected';
  cursor?: AdminPartnerApplicationCursor;
  limit?: number;
}

export interface AdminPayoutRecord {
  id: number;
  rmbAmount: number;
  accountType: 'wechat' | 'alipay' | 'bank';
  accountNo: string;
  accountName: string;
  status: PartnerWithdrawalStatus;
  appliedAt: Date;
  paidAt: Date | null;
  rejectReason: string | null;
  partner: {
    name: string | null;
    phone: string | null;
    region: string[];
  };
}

export interface AdminPayoutActionRecord {
  id: number;
  storeId: number;
  partnerId: number;
  beanAmount: number;
  status: PartnerWithdrawalStatusValue;
}

export interface AdminPayoutStats {
  pendingCount: number;
  pendingTotal: number;
  paidTotal: number;
}

export interface AdminPayoutCursor {
  appliedAt: Date;
  id: number;
}

export interface AdminPayoutListQueryInput {
  where: Prisma.PartnerWithdrawalWhereInput;
  tab?: PulsePayoutTabValue;
  cursor?: AdminPayoutCursor;
  limit?: number;
}

export interface AdminPromoPartnerRecord {
  storeId: number;
  name: string | null;
  phone: string | null;
  region: string[];
  joinedAt: Date | null;
  store: {
    name: string;
    owner: {
      name: string | null;
    };
    membershipPromoRecords: Array<{
      chargedAmount: number | null;
      chargedAt: Date | null;
      registeredAt: Date;
    }>;
  };
}

const ADMIN_PROMO_PARTNER_SELECT = {
  storeId: true,
  name: true,
  phone: true,
  region: true,
  joinedAt: true,
  store: {
    select: {
      name: true,
      owner: {
        select: {
          name: true,
        },
      },
      membershipPromoRecords: {
        where: { hasCharged: true },
        select: {
          chargedAmount: true,
          chargedAt: true,
          registeredAt: true,
        },
        orderBy: [{ chargedAt: 'asc' }, { registeredAt: 'asc' }, { id: 'asc' }],
      },
    },
  },
} satisfies Prisma.StorePartnerSelect;

const ADMIN_PARTNER_APPLICATION_SELECT = {
  id: true,
  name: true,
  phone: true,
  region: true,
  applyReason: true,
  createdAt: true,
  status: true,
} satisfies Prisma.StorePartnerApplicationSelect;

const ADMIN_PAYOUT_SELECT = {
  id: true,
  rmbAmount: true,
  accountType: true,
  accountNo: true,
  accountName: true,
  status: true,
  appliedAt: true,
  paidAt: true,
  rejectReason: true,
  partner: {
    select: {
      name: true,
      phone: true,
      region: true,
    },
  },
} satisfies Prisma.PartnerWithdrawalSelect;

const ADMIN_PARTNER_APPLICATION_ACCESS_SELECT = {
  id: true,
  storeId: true,
} satisfies Prisma.StorePartnerApplicationSelect;

const ADMIN_PAYOUT_ACTION_SELECT = {
  id: true,
  storeId: true,
  partnerId: true,
  beanAmount: true,
  status: true,
} satisfies Prisma.PartnerWithdrawalSelect;

export async function queryAdminPromoPartners(
  prisma: PrismaService,
  storeWhere: Prisma.StoreWhereInput,
): Promise<AdminPromoPartnerRecord[]> {
  return prisma.storePartner.findMany({
    where: {
      status: 'approved',
      store: storeWhere,
    },
    select: ADMIN_PROMO_PARTNER_SELECT,
    orderBy: [{ joinedAt: 'desc' }, { storeId: 'asc' }],
  }) as Promise<AdminPromoPartnerRecord[]>;
}

export async function queryAdminPartnerApplications(
  prisma: PrismaService,
  input: AdminPartnerApplicationListQueryInput,
): Promise<AdminPartnerApplicationRecord[]> {
  return prisma.storePartnerApplication.findMany({
    where: buildAdminPartnerApplicationListWhere(input),
    select: ADMIN_PARTNER_APPLICATION_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(input.limit !== undefined ? { take: input.limit + 1 } : {}),
  }) as Promise<AdminPartnerApplicationRecord[]>;
}

export async function queryAdminPartnerApplicationStats(
  prisma: PrismaService,
  where: Prisma.StorePartnerApplicationWhereInput,
): Promise<AdminPartnerApplicationStats> {
  const grouped = await prisma.storePartnerApplication.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });

  return grouped.reduce<AdminPartnerApplicationStats>(
    (summary, record) => {
      switch (record.status) {
        case 'approved':
          summary.approvedCount += record._count._all;
          break;
        case 'rejected':
          summary.rejectedCount += record._count._all;
          break;
        default:
          summary.pendingCount += record._count._all;
          break;
      }

      return summary;
    },
    {
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    },
  );
}

function buildAdminPartnerApplicationListWhere(
  input: AdminPartnerApplicationListQueryInput,
): Prisma.StorePartnerApplicationWhereInput {
  return {
    ...input.where,
    ...buildAdminPartnerApplicationTabWhere(input.tab),
    ...(input.cursor
      ? {
          OR: [
            { createdAt: { lt: input.cursor.createdAt } },
            {
              createdAt: input.cursor.createdAt,
              id: { lt: input.cursor.id },
            },
          ],
        }
      : {}),
  };
}

function buildAdminPartnerApplicationTabWhere(
  tab?: AdminPartnerApplicationListQueryInput['tab'],
): Prisma.StorePartnerApplicationWhereInput {
  switch (tab) {
    case 'pending':
      return { status: 'pending' };
    case 'approved':
      return { status: 'approved' };
    case 'rejected':
      return { status: 'rejected' };
    case 'all':
    default:
      return {};
  }
}

export async function queryAdminPartnerApplicationAccessRecord(
  prisma: PrismaService,
  applicationId: number,
): Promise<AdminPartnerApplicationAccessRecord | null> {
  return prisma.storePartnerApplication.findUnique({
    where: { id: applicationId },
    select: ADMIN_PARTNER_APPLICATION_ACCESS_SELECT,
  }) as Promise<AdminPartnerApplicationAccessRecord | null>;
}

export async function queryAdminPayouts(
  prisma: PrismaService,
  input: AdminPayoutListQueryInput,
): Promise<AdminPayoutRecord[]> {
  return prisma.partnerWithdrawal.findMany({
    where: buildAdminPayoutListWhere(input),
    select: ADMIN_PAYOUT_SELECT,
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    ...(input.limit !== undefined ? { take: input.limit + 1 } : {}),
  }) as Promise<AdminPayoutRecord[]>;
}

export async function queryAdminPayoutStats(
  prisma: PrismaService,
  where: Prisma.PartnerWithdrawalWhereInput,
): Promise<AdminPayoutStats> {
  const grouped = await prisma.partnerWithdrawal.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
    _sum: { rmbAmount: true },
  });

  return grouped.reduce<AdminPayoutStats>(
    (summary, record) => {
      switch (record.status) {
        case PartnerWithdrawalStatus.pending:
        case PartnerWithdrawalStatus.approved:
          summary.pendingCount += record._count._all;
          summary.pendingTotal += record._sum.rmbAmount ?? 0;
          break;
        case PartnerWithdrawalStatus.paid:
          summary.paidTotal += record._sum.rmbAmount ?? 0;
          break;
        default:
          break;
      }

      return summary;
    },
    {
      pendingCount: 0,
      pendingTotal: 0,
      paidTotal: 0,
    },
  );
}

function buildAdminPayoutListWhere(
  input: AdminPayoutListQueryInput,
): Prisma.PartnerWithdrawalWhereInput {
  return {
    ...input.where,
    ...buildAdminPayoutTabWhere(input.tab),
    ...(input.cursor
      ? {
          OR: [
            { appliedAt: { lt: input.cursor.appliedAt } },
            {
              appliedAt: input.cursor.appliedAt,
              id: { lt: input.cursor.id },
            },
          ],
        }
      : {}),
  };
}

function buildAdminPayoutTabWhere(
  tab?: PulsePayoutTabValue,
): Prisma.PartnerWithdrawalWhereInput {
  switch (tab) {
    case 'pending':
      return {
        status: {
          in: [
            PartnerWithdrawalStatus.pending,
            PartnerWithdrawalStatus.approved,
          ],
        },
      };
    case 'paid':
      return { status: PartnerWithdrawalStatus.paid };
    case 'rejected':
      return { status: PartnerWithdrawalStatus.rejected };
    case 'all':
    default:
      return {};
  }
}

export async function queryAdminPayoutActionRecord(
  prisma: PrismaService,
  payoutId: number,
): Promise<AdminPayoutActionRecord | null> {
  return prisma.partnerWithdrawal.findUnique({
    where: { id: payoutId },
    select: ADMIN_PAYOUT_ACTION_SELECT,
  }) as Promise<AdminPayoutActionRecord | null>;
}
