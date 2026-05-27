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

export interface EarningsOverviewPartnerRecord {
  status: string;
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
}

export interface EarningsOverviewPromoRecord {
  hasCharged: boolean;
}

export interface EarningsOverviewQueryResult {
  partner: EarningsOverviewPartnerRecord | null;
  promoRecords: EarningsOverviewPromoRecord[];
  pendingWithdrawals: number;
}

export interface EarningsApprovedPartnerRecord {
  id: number;
  status: string;
  beanBalance: number;
}

export interface WithdrawalAccountPartnerRecord {
  status: string;
  beanBalance: number;
  paymentAccountType: 'wechat' | 'alipay' | 'bank' | null;
  paymentAccountNo: string | null;
  paymentAccountName: string | null;
}

const EARNINGS_OVERVIEW_PARTNER_SELECT = {
  status: true,
  beanBalance: true,
  totalEarnedBeans: true,
  totalWithdrawnBeans: true,
} satisfies Prisma.StorePartnerSelect;

const EARNINGS_OVERVIEW_PROMO_SELECT = {
  hasCharged: true,
} satisfies Prisma.StoreMembershipPromoRecordSelect;

const EARNINGS_APPROVED_PARTNER_SELECT = {
  id: true,
  status: true,
  beanBalance: true,
} satisfies Prisma.StorePartnerSelect;

const PARTNER_BEAN_LOG_SELECT = {
  id: true,
  source: true,
  changeAmount: true,
  description: true,
  relatedPromoRecordId: true,
  relatedUser: true,
  createdAt: true,
} satisfies Prisma.StorePartnerBeanLogSelect;

const WITHDRAWAL_ACCOUNT_PARTNER_SELECT = {
  status: true,
  beanBalance: true,
  paymentAccountType: true,
  paymentAccountNo: true,
  paymentAccountName: true,
} satisfies Prisma.StorePartnerSelect;

export async function queryEarningsOverviewData(
  prisma: PrismaService,
  storeId: number,
): Promise<EarningsOverviewQueryResult> {
  const [partner, promoRecords, pendingWithdrawals] = await Promise.all([
    prisma.storePartner.findUnique({
      where: { storeId },
      select: EARNINGS_OVERVIEW_PARTNER_SELECT,
    }) as Promise<EarningsOverviewPartnerRecord | null>,
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
    partner,
    promoRecords,
    pendingWithdrawals,
  };
}

export async function queryApprovedPartnerRecord(
  prisma: PrismaService,
  storeId: number,
): Promise<EarningsApprovedPartnerRecord | null> {
  return prisma.storePartner.findUnique({
    where: { storeId },
    select: EARNINGS_APPROVED_PARTNER_SELECT,
  }) as Promise<EarningsApprovedPartnerRecord | null>;
}

export async function queryPartnerBeanLogs(
  prisma: PrismaService,
  storeId: number,
  partnerId: number,
): Promise<PartnerBeanLogRecord[]> {
  return prisma.storePartnerBeanLog.findMany({
    where: { storeId, partnerId },
    select: PARTNER_BEAN_LOG_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }) as Promise<PartnerBeanLogRecord[]>;
}

export async function queryWithdrawalAccountPartner(
  prisma: PrismaService,
  storeId: number,
): Promise<WithdrawalAccountPartnerRecord | null> {
  return prisma.storePartner.findUnique({
    where: { storeId },
    select: WITHDRAWAL_ACCOUNT_PARTNER_SELECT,
  }) as Promise<WithdrawalAccountPartnerRecord | null>;
}
