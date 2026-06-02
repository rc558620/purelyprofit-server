import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountPartnerDto,
  PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth-earnings.dto';
import {
  buildApprovedPartnerResponse,
  buildApprovedPartnersResponse,
} from '../../purely-profit/member/platform-membership/platform-membership.domain';
import type {
  EarningsApprovedPartnerRecord,
  EarningsOverviewQueryResult,
  PartnerBeanLogRecord,
  WithdrawalAccountPartnerRecord,
} from './growth-earnings.query';

type BeanTypeValue = 'earn' | 'spend' | 'withdraw';

export function buildEarningsOverviewResponse(
  data: EarningsOverviewQueryResult,
): PulseEarningsOverviewResponseDto {
  const primaryPartner = data.partners[0] ?? null;
  const isPartner = primaryPartner?.status === 'approved';
  const chargedPromos = data.promoRecords.filter(
    (record) => record.hasCharged,
  ).length;

  // 聚合所有正式合伙人的豆豆统计
  const beanSummary = data.partners
    .filter((p) => p.status === 'approved')
    .reduce(
      (sum, partner) => ({
        beanBalance: sum.beanBalance + partner.beanBalance,
        totalEarnedBeans: sum.totalEarnedBeans + partner.totalEarnedBeans,
        totalWithdrawnBeans:
          sum.totalWithdrawnBeans + partner.totalWithdrawnBeans,
      }),
      {
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    );

  return {
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(data.partners),
    beanBalance: isPartner ? beanSummary.beanBalance : 0,
    totalEarnedBeans: isPartner ? beanSummary.totalEarnedBeans : 0,
    totalWithdrawnBeans: isPartner ? beanSummary.totalWithdrawnBeans : 0,
    totalPromos: data.promoRecords.length,
    chargedPromos,
    isPartner,
    pendingWithdrawals: data.pendingWithdrawals,
  };
}

export function buildEarningsLogsResponse(input: {
  partners: EarningsApprovedPartnerRecord[];
  logs: PartnerBeanLogRecord[];
  ownerName: string | null;
  limit?: number;
}): PulseEarningsLogsResponseDto {
  const primaryPartner = input.partners[0] ?? null;
  if (!primaryPartner || primaryPartner.status !== 'approved') {
    return {
      approvedPartner: null,
      approvedPartners: [],
      items: [],
      beanBalance: 0,
      hasMore: false,
      nextCursor: null,
    };
  }

  const hasMore = input.limit !== undefined && input.logs.length > input.limit;
  const visibleLogs = hasMore ? input.logs.slice(0, input.limit) : input.logs;

  // 聚合所有正式合伙人的豆豆余额
  const beanBalance = input.partners
    .filter((p) => p.status === 'approved')
    .reduce((sum, partner) => sum + partner.beanBalance, 0);

  return {
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(input.partners),
    items: visibleLogs.map((log) => mapBeanLog(log, input.ownerName)),
    beanBalance,
    hasMore,
    nextCursor: hasMore
      ? encodeEarningsLogsCursor(visibleLogs.at(-1) ?? null)
      : null,
  };
}

export function buildWithdrawalAccountResponse(
  partners: WithdrawalAccountPartnerRecord[],
): PulseWithdrawalAccountResponseDto {
  const primaryPartner = partners[0] ?? null;
  const isPartner = primaryPartner?.status === 'approved';

  if (!isPartner) {
    return {
      isPartner: false,
      selectedPartner: null,
      approvedPartner: null,
      approvedPartners: [],
      accountType: null,
      accountNo: null,
      accountName: null,
      beanBalance: 0,
    };
  }

  // 聚合所有正式合伙人的豆豆余额
  const beanBalance = partners
    .filter((p) => p.status === 'approved')
    .reduce((sum, partner) => sum + partner.beanBalance, 0);

  return {
    isPartner: true,
    selectedPartner: mapWithdrawalAccountPartner(primaryPartner),
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(partners),
    accountType: primaryPartner.paymentAccountType ?? null,
    accountNo: primaryPartner.paymentAccountNo ?? null,
    accountName: primaryPartner.paymentAccountName ?? null,
    beanBalance,
  };
}

function mapWithdrawalAccountPartner(
  partner: WithdrawalAccountPartnerRecord | null,
): PulseWithdrawalAccountPartnerDto | null {
  if (!partner) {
    return null;
  }

  return {
    id: String(partner.id),
    name: partner.name ?? '',
    phone: partner.phone ?? '',
    ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
    beanBalance: partner.beanBalance,
    totalEarnedBeans: partner.totalEarnedBeans,
    totalWithdrawnBeans: partner.totalWithdrawnBeans,
    accountType: partner.paymentAccountType ?? null,
    accountNo: partner.paymentAccountNo ?? null,
    accountName: partner.paymentAccountName ?? null,
  };
}

export function parseEarningsLogsCursor(
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

export function encodeEarningsLogsCursor(
  log: Pick<PartnerBeanLogRecord, 'createdAt' | 'id'> | null,
): string | null {
  if (!log) {
    return null;
  }

  return `${log.createdAt.getTime()}_${log.id}`;
}

function resolveBeanType(log: PartnerBeanLogRecord): BeanTypeValue {
  if (log.source === 'withdrawal') {
    return 'withdraw';
  }

  return log.changeAmount >= 0 ? 'earn' : 'spend';
}

function mapBeanLog(
  log: PartnerBeanLogRecord,
  ownerName: string | null,
): PulseEarningsLogsResponseDto['items'][number] {
  return {
    id: `bean-${log.id}`,
    userId: `store-owner-${log.id}`,
    userName: ownerName ?? '目标商家',
    userPhone: '',
    amount: log.changeAmount,
    type: resolveBeanType(log),
    source: log.source,
    description: log.description,
    relatedPromoId:
      log.relatedPromoRecordId != null
        ? `promo-${log.relatedPromoRecordId}`
        : undefined,
    relatedUser: log.relatedUser ?? undefined,
    createdAt: log.createdAt.getTime(),
  };
}
