import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import type {
  PlatformMembershipCenterResponseDto,
  PlatformMembershipPartnerLevelDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipPromoRecordDto,
  PlatformMembershipPromoStatsDto,
} from './dto/platform-membership-response.dto';
import type {
  PartnerLevelValue,
  StoreMembershipPromoRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export function buildCenterStats(
  promoRecords: StoreMembershipPromoRecord[],
  partnerCount: number,
): PlatformMembershipCenterResponseDto['stats'] {
  const chargedPromos = promoRecords.filter(
    (record) => record.hasCharged,
  ).length;
  return {
    partnerCount,
    totalPromos: promoRecords.length,
    chargedPromos,
  };
}

export function buildPromoStats(
  promoRecords: StoreMembershipPromoRecord[],
): PlatformMembershipPromoStatsDto {
  const chargedPromos = promoRecords.filter(
    (record) => record.hasCharged,
  ).length;
  const earnedBeans = promoRecords.reduce(
    (sum, record) => sum + (record.rewardBeans ?? 0),
    0,
  );
  return {
    totalPromos: promoRecords.length,
    chargedPromos,
    promoRate:
      promoRecords.length > 0
        ? Math.round((chargedPromos / promoRecords.length) * 100)
        : 0,
    earnedBeans,
  };
}

export function buildPromoStatsByPeriod(
  promoRecords: StoreMembershipPromoRecord[],
): PlatformMembershipPromoCenterResponseDto['statsByPeriod'] {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const yearStart = new Date(now);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);

  return {
    all: buildPromoStats(promoRecords),
    today: buildPromoStatsForPeriod(promoRecords, todayStart),
    month: buildPromoStatsForPeriod(promoRecords, monthStart),
    year: buildPromoStatsForPeriod(promoRecords, yearStart),
  };
}

export function buildPromoStatsForPeriod(
  promoRecords: StoreMembershipPromoRecord[],
  startAt: Date,
): PlatformMembershipPromoStatsDto {
  const startTimestamp = startAt.getTime();
  const filteredRecords = promoRecords.filter(
    (record) => record.registeredAt.getTime() >= startTimestamp,
  );

  return buildPromoStats(filteredRecords);
}

export function mapPromoRecord(
  record: StoreMembershipPromoRecord,
): PlatformMembershipPromoRecordDto {
  return {
    id: `promo-${record.id}`,
    inviteeName: record.inviteeName,
    inviteePhone: record.inviteePhone,
    registeredAt: record.registeredAt.getTime(),
    hasCharged: record.hasCharged,
    ...(record.chargedAmount !== null
      ? { chargedAmount: record.chargedAmount }
      : {}),
    ...(record.chargedAt ? { chargedAt: record.chargedAt.getTime() } : {}),
    ...(record.chargedPlan ? { chargedPlan: record.chargedPlan } : {}),
    ...(record.rewardBeans !== null ? { rewardBeans: record.rewardBeans } : {}),
    ...(record.hasCharged ? { settled: record.settled } : {}),
  };
}

export function buildPartnerLevel(
  partner: StorePartnerRecord | null,
  promoRecords: StoreMembershipPromoRecord[],
): PlatformMembershipPartnerLevelDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartTs = monthStart.getTime();
  const monthChargedCount = promoRecords.filter(
    (record) =>
      record.hasCharged &&
      record.chargedAt !== null &&
      record.chargedAt.getTime() >= monthStartTs,
  ).length;

  if (!partner || partner.status !== 'approved') {
    return {
      partnerLevel: null,
      monthChargedCount,
      monthCountToNextLevel: null,
      currentLevelRewards: PROMO_BEAN_REWARDS_BY_LEVEL.star,
    };
  }

  const partnerLevel = resolvePartnerLevel(monthChargedCount);

  return {
    partnerLevel,
    monthChargedCount,
    monthCountToNextLevel:
      partnerLevel === 'legend'
        ? null
        : partnerLevel === 'elite'
          ? Math.max(0, 30 - monthChargedCount)
          : Math.max(0, 10 - monthChargedCount),
    currentLevelRewards: PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel],
  };
}

export function resolvePartnerLevel(
  monthChargedCount: number,
): PartnerLevelValue {
  if (monthChargedCount >= 30) {
    return 'legend';
  }

  if (monthChargedCount >= 10) {
    return 'elite';
  }

  return 'star';
}
