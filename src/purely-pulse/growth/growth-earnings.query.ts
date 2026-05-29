import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export type BeanSourceValue =
  | 'promo_reward'
  | 'deduct_payment'
  | 'withdrawal'
  | 'admin_adjust';

export interface PartnerBeanLogRecord {
  id: number;
  source: BeanSourceValue;
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  createdAt: Date;
}

export interface EarningsApprovedPartnerRecord {
  id: number;
  status: string;
  name: string | null;
  phone: string | null;
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
  joinedAt: Date | null;
  paymentAccountType: 'wechat' | 'alipay' | 'bank' | null;
  paymentAccountNo: string | null;
  paymentAccountName: string | null;
}

export interface EarningsOverviewPromoRecord {
  hasCharged: boolean;
}

export interface EarningsOverviewQueryResult {
  partners: EarningsApprovedPartnerRecord[];
  promoRecords: EarningsOverviewPromoRecord[];
  pendingWithdrawals: number;
}

export interface WithdrawalAccountPartnerRecord extends EarningsApprovedPartnerRecord {}

const EARNINGS_PARTNER_SELECT = {
  id: true,
  status: true,
  name: true,
  phone: true,
  beanBalance: true,
  totalEarnedBeans: true,
  totalWithdrawnBeans: true,
  joinedAt: true,
  paymentAccountType: true,
  paymentAccountNo: true,
  paymentAccountName: true,
} satisfies Prisma.StorePartnerSelect;

const EARNINGS_OVERVIEW_PROMO_SELECT = {
  hasCharged: true,
} satisfies Prisma.StoreMembershipPromoRecordSelect;

const PARTNER_BEAN_LOG_SELECT = {
  id: true,
  source: true,
  changeAmount: true,
  description: true,
  relatedPromoRecordId: true,
  relatedUser: true,
  createdAt: true,
} satisfies Prisma.StorePartnerBeanLogSelect;

export async function queryEarningsOverviewData(
  prisma: PrismaService,
  storeId: number,
): Promise<EarningsOverviewQueryResult> {
  const [partners, promoRecords, pendingWithdrawals] = await Promise.all([
    prisma.storePartner.findMany({
      where: { storeId, status: 'approved' },
      select: EARNINGS_PARTNER_SELECT,
      orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
    }) as Promise<EarningsApprovedPartnerRecord[]>,
    prisma.storeMembershipPromoRecord.findMany({
      where: { storeId },
      select: EARNINGS_OVERVIEW_PROMO_SELECT,
    }) as Promise<EarningsOverviewPromoRecord[]>,
    prisma.partnerWithdrawal.count({
      where: {
        storeId,
        status: {
          in: [
            PartnerWithdrawalStatus.pending,
            PartnerWithdrawalStatus.approved,
          ],
        },
      },
    }),
  ]);

  return {
    partners,
    promoRecords,
    pendingWithdrawals,
  };
}

export async function queryApprovedPartnerRecord(
  prisma: PrismaService,
  storeId: number,
): Promise<EarningsApprovedPartnerRecord | null> {
  const partners = await prisma.storePartner.findMany({
    where: { storeId, status: 'approved' },
    select: EARNINGS_PARTNER_SELECT,
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  });

  return partners[0] ?? null;
}

export async function queryPartnerBeanLogs(
  prisma: PrismaService,
  storeId: number,
): Promise<PartnerBeanLogRecord[]> {
  return prisma.storePartnerBeanLog.findMany({
    where: { storeId },
    select: PARTNER_BEAN_LOG_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }) as Promise<PartnerBeanLogRecord[]>;
}

export async function queryWithdrawalAccountPartner(
  prisma: PrismaService,
  storeId: number,
): Promise<WithdrawalAccountPartnerRecord | null> {
  const partners = await prisma.storePartner.findMany({
    where: { storeId, status: 'approved' },
    select: EARNINGS_PARTNER_SELECT,
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  });

  return partners[0] ?? null;
}

export async function queryWithdrawalAccountPartners(
  prisma: PrismaService,
  storeId: number,
): Promise<WithdrawalAccountPartnerRecord[]> {
  return prisma.storePartner.findMany({
    where: { storeId, status: 'approved' },
    select: EARNINGS_PARTNER_SELECT,
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  }) as Promise<WithdrawalAccountPartnerRecord[]>;
}
