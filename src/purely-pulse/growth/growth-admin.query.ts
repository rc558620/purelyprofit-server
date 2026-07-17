import { Prisma } from '@prisma/client';
import type { PlatformPartnerIntention } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type { PrismaService } from '../../prisma/prisma.service';

export interface AdminPartnerApplicationRecord {
  id: number;
  name: string;
  phone: string;
  idCard: string;
  region: string[];
  intention: PlatformPartnerIntention;
  applyReason: string | null;
  createdAt: Date;
  status: string;
  store?: {
    owner: {
      avatar: string | null;
    };
  } | null;
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
      avatar: string | null;
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
          avatar: true,
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
  idCard: true,
  region: true,
  intention: true,
  applyReason: true,
  createdAt: true,
  status: true,
  store: {
    select: {
      owner: {
        select: {
          avatar: true,
        },
      },
    },
  },
} satisfies Prisma.StorePartnerApplicationSelect;

const ADMIN_PARTNER_APPLICATION_ACCESS_SELECT = {
  id: true,
  storeId: true,
} satisfies Prisma.StorePartnerApplicationSelect;

export async function queryAdminPromoPartners(
  prisma: PrismaService,
  storeWhere: Prisma.StoreWhereInput,
): Promise<AdminPromoPartnerRecord[]> {
  return prisma.storePartner.findMany({
    where: {
      deletedAt: null,
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
