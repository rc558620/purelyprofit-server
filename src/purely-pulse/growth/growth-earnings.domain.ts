import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsLogTypeValue,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountPartnerDto,
  PulseWithdrawalAccountResponseDto,
} from './dto/pulse-growth.dto';
import type {
  PlatformMembershipApprovedPartnerDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
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
    approvedPartner: mapApprovedPartner(primaryPartner),
    approvedPartners: mapApprovedPartners(data.partners),
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
  typeFilter: PulseEarningsLogTypeValue;
}): PulseEarningsLogsResponseDto {
  const primaryPartner = input.partners[0] ?? null;
  if (!primaryPartner || primaryPartner.status !== 'approved') {
    return {
      approvedPartner: null,
      approvedPartners: [],
      items: [],
      beanBalance: 0,
    };
  }

  const filteredLogs = filterLogsByType(input.logs, input.typeFilter);

  // 聚合所有正式合伙人的豆豆余额
  const beanBalance = input.partners
    .filter((p) => p.status === 'approved')
    .reduce((sum, partner) => sum + partner.beanBalance, 0);

  return {
    approvedPartner: mapApprovedPartner(primaryPartner),
    approvedPartners: mapApprovedPartners(input.partners),
    items: filteredLogs.map((log) => mapBeanLog(log, input.ownerName)),
    beanBalance,
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
    approvedPartner: mapApprovedPartner(primaryPartner),
    approvedPartners: mapApprovedPartners(partners),
    accountType: primaryPartner.paymentAccountType ?? null,
    accountNo: primaryPartner.paymentAccountNo ?? null,
    accountName: primaryPartner.paymentAccountName ?? null,
    beanBalance,
  };
}

function mapApprovedPartner(
  partner: EarningsApprovedPartnerRecord | null,
): PlatformMembershipApprovedPartnerDto | null {
  if (!partner || partner.status !== 'approved') {
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
  };
}

function mapApprovedPartners(
  partners: EarningsApprovedPartnerRecord[],
): PlatformMembershipApprovedPartnerDto[] {
  return partners
    .filter((partner) => partner.status === 'approved')
    .map((partner) => ({
      id: String(partner.id),
      name: partner.name ?? '',
      phone: partner.phone ?? '',
      ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    }));
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
