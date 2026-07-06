import Decimal from 'decimal.js';
import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountPartnerDto,
  PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth-earnings.dto';
import { buildApprovedPartnerResponse } from '../../purely-profit/member/platform-membership/platform-membership.domain';
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
  const partner = data.partner;
  const isPartner = partner?.status === 'approved';
  const chargedPromos = data.promoRecords.filter(
    (record) => record.hasCharged,
  ).length;

  const approved = buildApprovedPartnerResponse(partner);

  return {
    approvedPartner: approved,
    approvedPartners: approved ? [approved] : [],
    beanBalance: isPartner ? partner.beanBalance : 0,
    totalEarnedBeans: isPartner ? partner.totalEarnedBeans : 0,
    totalWithdrawnBeans: isPartner ? partner.totalWithdrawnBeans : 0,
    pendingBeans: isPartner
      ? Decimal.max(
          0,
          new Decimal(partner.totalEarnedBeans)
            .minus(partner.totalWithdrawnBeans)
            .minus(partner.beanBalance),
        ).toNumber()
      : 0,
    totalPromos: data.promoRecords.length,
    chargedPromos,
    isPartner,
    pendingWithdrawals: data.pendingWithdrawals,
  };
}

export function buildEarningsLogsResponse(input: {
  partner: EarningsApprovedPartnerRecord | null;
  logs: PartnerBeanLogRecord[];
  ownerName: string | null;
  limit?: number;
}): PulseEarningsLogsResponseDto {
  const partner = input.partner;
  if (!partner || partner.status !== 'approved') {
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
  const approved = buildApprovedPartnerResponse(partner);

  return {
    approvedPartner: approved,
    approvedPartners: approved ? [approved] : [],
    items: visibleLogs.map((log) => mapBeanLog(log, input.ownerName)),
    beanBalance: partner.beanBalance,
    hasMore,
    nextCursor: hasMore
      ? encodeEarningsLogsCursor(visibleLogs.at(-1) ?? null)
      : null,
  };
}

export function buildWithdrawalAccountResponse(
  partner: WithdrawalAccountPartnerRecord | null,
): PulseWithdrawalAccountResponseDto {
  const isPartner = partner?.status === 'approved';

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

  const approved = buildApprovedPartnerResponse(partner);

  return {
    isPartner: true,
    selectedPartner: mapWithdrawalAccountPartner(partner),
    approvedPartner: approved,
    approvedPartners: approved ? [approved] : [],
    accountType: partner.paymentAccountType ?? null,
    accountNo: partner.paymentAccountNo ?? null,
    accountName: partner.paymentAccountName ?? null,
    beanBalance: partner.beanBalance,
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
    avatarUrl: partner.store?.owner?.avatar ?? undefined,
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
    userId: 'store-owner',
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
