import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { PulseEarningsLogTypeValue } from './dto/pulse-growth.dto';
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

export type WithdrawalAccountPartnerRecord = EarningsApprovedPartnerRecord;

export interface PartnerBeanLogsCursor {
  createdAt: Date;
  id: number;
}

export interface PartnerBeanLogsQueryInput {
  storeId: number;
  typeFilter: PulseEarningsLogTypeValue;
  cursor?: PartnerBeanLogsCursor;
  limit?: number;
}

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

export async function queryPartnerBeanLogs(
  prisma: PrismaService,
  input: PartnerBeanLogsQueryInput,
): Promise<PartnerBeanLogRecord[]> {
  return prisma.storePartnerBeanLog.findMany({
    where: buildPartnerBeanLogsWhere(input),
    select: PARTNER_BEAN_LOG_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(input.limit !== undefined ? { take: input.limit + 1 } : {}),
  }) as Promise<PartnerBeanLogRecord[]>;
}

function buildPartnerBeanLogsWhere(
  input: PartnerBeanLogsQueryInput,
): Prisma.StorePartnerBeanLogWhereInput {
  return {
    storeId: input.storeId,
    ...buildPartnerBeanLogsTypeWhere(input.typeFilter),
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

function buildPartnerBeanLogsTypeWhere(
  typeFilter: PulseEarningsLogTypeValue,
): Prisma.StorePartnerBeanLogWhereInput {
  switch (typeFilter) {
    case 'earn':
      return {
        source: { not: 'withdrawal' },
        changeAmount: { gte: 0 },
      };
    case 'spend':
      return {
        source: { not: 'withdrawal' },
        changeAmount: { lt: 0 },
      };
    case 'withdraw':
      return { source: 'withdrawal' };
    case 'all':
    default:
      return {};
  }
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
