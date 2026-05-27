import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsLogTypeValue,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth.dto';
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
  const isPartner = data.partner?.status === 'approved';
  const chargedPromos = data.promoRecords.filter(
    (record) => record.hasCharged,
  ).length;

  return {
    beanBalance: isPartner ? (data.partner?.beanBalance ?? 0) : 0,
    totalEarnedBeans: isPartner ? (data.partner?.totalEarnedBeans ?? 0) : 0,
    totalWithdrawnBeans: isPartner
      ? (data.partner?.totalWithdrawnBeans ?? 0)
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
  typeFilter: PulseEarningsLogTypeValue;
}): PulseEarningsLogsResponseDto {
  if (!input.partner || input.partner.status !== 'approved') {
    return { items: [], beanBalance: 0 };
  }

  const filteredLogs = filterLogsByType(input.logs, input.typeFilter);

  return {
    items: filteredLogs.map((log) => mapBeanLog(log, input.ownerName)),
    beanBalance: input.partner.beanBalance,
  };
}

export function buildWithdrawalAccountResponse(
  partner: WithdrawalAccountPartnerRecord | null,
): PulseWithdrawalAccountResponseDto {
  const isPartner = partner?.status === 'approved';

  if (!isPartner) {
    return {
      isPartner: false,
      accountType: null,
      accountNo: null,
      accountName: null,
      beanBalance: 0,
    };
  }

  return {
    isPartner: true,
    accountType: partner.paymentAccountType ?? null,
    accountNo: partner.paymentAccountNo ?? null,
    accountName: partner.paymentAccountName ?? null,
    beanBalance: partner.beanBalance ?? 0,
  };
}

function filterLogsByType(
  logs: PartnerBeanLogRecord[],
  type: PulseEarningsLogTypeValue,
): PartnerBeanLogRecord[] {
  if (type === 'all') {
    return logs;
  }

  return logs.filter((log) => resolveBeanType(log) === type);
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
