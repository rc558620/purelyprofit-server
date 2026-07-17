import {
  PartnerWithdrawalStatus,
  Prisma,
  type PartnerWithdrawalStatus as PartnerWithdrawalStatusValue,
} from '@prisma/client';
import type { PulsePayoutTabValue } from './dto/pulse-growth-admin.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';

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
    store?: {
      owner: {
        avatar: string | null;
      };
    } | null;
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
      store: {
        select: {
          owner: {
            select: {
              avatar: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PartnerWithdrawalSelect;

const ADMIN_PAYOUT_ACTION_SELECT = {
  id: true,
  storeId: true,
  partnerId: true,
  beanAmount: true,
  status: true,
} satisfies Prisma.PartnerWithdrawalSelect;

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

  let pendingAmounts: Money[] = [];
  let paidAmounts: Money[] = [];
  let pendingCount = 0;

  for (const record of grouped) {
    const amount = Money.fromDbCents(record._sum.rmbAmount ?? 0);
    switch (record.status) {
      case PartnerWithdrawalStatus.pending:
      case PartnerWithdrawalStatus.approved:
        pendingCount += record._count._all;
        pendingAmounts = pendingAmounts.concat(amount);
        break;
      case PartnerWithdrawalStatus.paid:
        paidAmounts = paidAmounts.concat(amount);
        break;
      default:
        break;
    }
  }

  return {
    pendingCount,
    pendingTotal: Money.sum(pendingAmounts).toDbCents(),
    paidTotal: Money.sum(paidAmounts).toDbCents(),
  };
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
