import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import {
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
  getShanghaiYearStartMs,
} from '../../../shared/shanghai-time.utils';
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

/** 晋升 elite 档所需的本月已充值推广人数阈值。 */
const ELITE_LEVEL_THRESHOLD = 10;
/** 晋升 legend 档所需的本月已充值推广人数阈值。 */
const LEGEND_LEVEL_THRESHOLD = 30;

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
  const now = Date.now();
  const todayStart = new Date(getShanghaiDayStartMs(now));
  const monthStart = new Date(getShanghaiMonthStartMs(now));
  const yearStart = new Date(getShanghaiYearStartMs(now));

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
  const monthStartTs = getShanghaiMonthStartMs(Date.now());
  // 仅统计归属该合伙人的推广记录（schema 已含 partnerId），
  // 避免把门店其他合伙人/历史记录的充值数并入当前合伙人等级（见 B1）。
  // 过滤收口在此处，确保所有调用点（合伙人档案/推广中心/推广详情兼容）口径一致，
  // 避免在各调用点分散过滤导致的遗漏回归。
  const scopedPromoRecords =
    partner !== null
      ? promoRecords.filter((record) => record.partnerId === partner.id)
      : promoRecords;
  const monthChargedCount = scopedPromoRecords.filter(
    (record) =>
      record.hasCharged &&
      record.chargedAt !== null &&
      record.chargedAt.getTime() >= monthStartTs,
  ).length;

  if (!partner || partner.status !== 'approved') {
    // 非合伙人：等级为空，但"距离下一等级"应表示距首档（elite）还差多少人，
    // 用 0 表示已达首档；不能用 null（null 仅代表"已达最高等级 legend"），
    // 否则前端会把非合伙人误解读为"已满级"（见 B4）。
    return {
      partnerLevel: null,
      monthChargedCount,
      monthCountToNextLevel: Math.max(
        0,
        ELITE_LEVEL_THRESHOLD - monthChargedCount,
      ),
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
          ? Math.max(0, LEGEND_LEVEL_THRESHOLD - monthChargedCount)
          : Math.max(0, ELITE_LEVEL_THRESHOLD - monthChargedCount),
    currentLevelRewards: PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel],
  };
}

export function resolvePartnerLevel(
  monthChargedCount: number,
): PartnerLevelValue {
  if (monthChargedCount >= LEGEND_LEVEL_THRESHOLD) {
    return 'legend';
  }

  if (monthChargedCount >= ELITE_LEVEL_THRESHOLD) {
    return 'elite';
  }

  return 'star';
}
