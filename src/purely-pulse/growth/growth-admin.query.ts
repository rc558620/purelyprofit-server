import { Prisma, type PartnerWithdrawalStatus } from '@prisma/client';
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
  status: PartnerWithdrawalStatus;
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
  where: Prisma.StorePartnerApplicationWhereInput,
): Promise<AdminPartnerApplicationRecord[]> {
  return prisma.storePartnerApplication.findMany({
    where,
    select: ADMIN_PARTNER_APPLICATION_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }) as Promise<AdminPartnerApplicationRecord[]>;
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
  where: Prisma.PartnerWithdrawalWhereInput,
): Promise<AdminPayoutRecord[]> {
  return prisma.partnerWithdrawal.findMany({
    where,
    select: ADMIN_PAYOUT_SELECT,
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
  }) as Promise<AdminPayoutRecord[]>;
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
