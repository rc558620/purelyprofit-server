import type {
  PlatformMembershipCenterResponseDto,
  PlatformMembershipPartnerLevelDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipPromoRecordDto,
  PlatformMembershipPromoStatsDto,
} from './dto/platform-membership-response.dto';
import { DAY_MS } from './platform-membership.constants';
import {
  buildApprovedPartnerResponse,
  buildMembershipInfo,
} from './platform-membership.domain';
import type {
  PartnerLevelValue,
  PromoDetailCompatFilters,
  PromoDetailCompatQueryMode,
  PromoDetailCompatRange,
  PromoDetailDateParts,
  PromotionDetailCompatResponse,
  StoreMembershipProfileRecord,
  StoreMembershipPromoRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export function buildCenterStats(
  promoRecords: StoreMembershipPromoRecord[],
): PlatformMembershipCenterResponseDto['stats'] {
  const chargedPromos = promoRecords.filter(
    (record) => record.hasCharged,
  ).length;
  return {
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

export function resolvePromoDetailCompatFilters(
  rawQuery: Record<string, unknown>,
): PromoDetailCompatFilters {
  const queryMode = resolvePromoDetailCompatQueryMode(rawQuery.queryMode);
  const normalizedDate = normalizePromoDetailCompatDate(
    readQueryString(rawQuery, 'date'),
    queryMode,
  );
  const keyword = normalizePromoDetailCompatKeyword(
    readQueryString(rawQuery, 'keyword') ??
      readQueryString(rawQuery, 'searchKeyword') ??
      readQueryString(rawQuery, 'query') ??
      readQueryString(rawQuery, 'name'),
  );

  return {
    queryMode,
    date: normalizedDate,
    keyword,
  };
}

export function resolvePromoDetailCompatQueryMode(
  value: unknown,
): PromoDetailCompatQueryMode {
  if (typeof value !== 'string') {
    return 'all';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'day' || normalized === 'today') {
    return 'day';
  }
  if (normalized === 'month') {
    return 'month';
  }
  if (normalized === 'year') {
    return 'year';
  }
  return 'all';
}

export function readQueryString(
  rawQuery: Record<string, unknown>,
  key: string,
): string | null {
  const value = rawQuery[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

export function normalizePromoDetailCompatKeyword(
  value: string | null,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

export function normalizePromoDetailCompatDate(
  value: string | null,
  queryMode: PromoDetailCompatQueryMode,
): string | null {
  if (queryMode === 'all') {
    return value?.trim() || null;
  }

  const parsed = parsePromoDetailDateParts(value);
  const now = new Date();

  if (queryMode === 'day') {
    const year = parsed?.year ?? now.getFullYear();
    const month = parsed?.month ?? now.getMonth() + 1;
    const day = parsed?.day ?? now.getDate();
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  }

  if (queryMode === 'month') {
    const year = parsed?.year ?? now.getFullYear();
    const month = parsed?.month ?? now.getMonth() + 1;
    return `${year}/${String(month).padStart(2, '0')}`;
  }

  const year = parsed?.year ?? now.getFullYear();
  return String(year);
}

export function parsePromoDetailDateParts(
  value: string | null,
): PromoDetailDateParts | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/[-.]/g, '/');
  if (!normalized) {
    return null;
  }

  const fullDateMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (fullDateMatch) {
    const year = Number(fullDateMatch[1]);
    const month = Number(fullDateMatch[2]);
    const day = Number(fullDateMatch[3]);
    if (!isValidPromoDetailDate(year, month, day)) {
      return null;
    }
    return { year, month, day };
  }

  const monthMatch = /^(\d{4})\/(\d{1,2})$/.exec(normalized);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (!isValidPromoDetailDate(year, month, 1)) {
      return null;
    }
    return { year, month };
  }

  const yearMatch = /^(\d{4})$/.exec(normalized);
  if (yearMatch) {
    return { year: Number(yearMatch[1]) };
  }

  return null;
}

export function isValidPromoDetailDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const candidate = new Date(year, month - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

export function resolvePromoDetailCompatRange(
  queryMode: PromoDetailCompatQueryMode,
  normalizedDate: string | null,
): PromoDetailCompatRange | null {
  if (queryMode === 'all') {
    return null;
  }

  const parsed = parsePromoDetailDateParts(normalizedDate);
  const now = new Date();
  const year = parsed?.year ?? now.getFullYear();
  const month = parsed?.month ?? now.getMonth() + 1;
  const day = parsed?.day ?? now.getDate();

  if (queryMode === 'day') {
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    return {
      start,
      end: start + DAY_MS,
    };
  }

  if (queryMode === 'month') {
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
    return {
      start,
      end: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    };
  }

  const start = new Date(year, 0, 1, 0, 0, 0, 0).getTime();
  return {
    start,
    end: new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime(),
  };
}

export function filterPromoRecordsForCompat(
  promoRecords: StoreMembershipPromoRecord[],
  filters: PromoDetailCompatFilters,
): StoreMembershipPromoRecord[] {
  const range = resolvePromoDetailCompatRange(filters.queryMode, filters.date);

  return promoRecords.filter((record) => {
    if (filters.keyword) {
      const inviteeName = record.inviteeName.toLowerCase();
      const inviteePhone = record.inviteePhone.toLowerCase();
      if (
        !inviteeName.includes(filters.keyword) &&
        !inviteePhone.includes(filters.keyword)
      ) {
        return false;
      }
    }

    if (!range) {
      return true;
    }

    const registeredAt = record.registeredAt.getTime();
    return registeredAt >= range.start && registeredAt < range.end;
  });
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

export function buildPromotionDetailCompatResponse(params: {
  profile: StoreMembershipProfileRecord;
  partner: StorePartnerRecord | null;
  promoRecords: StoreMembershipPromoRecord[];
  filteredRecords: StoreMembershipPromoRecord[];
  filters: PromoDetailCompatFilters;
}): PromotionDetailCompatResponse {
  const items = params.filteredRecords.map((record) => mapPromoRecord(record));
  const memberInfo = buildMembershipInfo(params.profile);

  return {
    inviteCode: memberInfo.inviteCode,
    promoCode: memberInfo.inviteCode,
    memberInfo,
    approvedPartner: buildApprovedPartnerResponse(params.partner),
    level: buildPartnerLevel(params.partner, params.promoRecords),
    stats: buildPromoStats(params.filteredRecords),
    statsByPeriod: buildPromoStatsByPeriod(params.promoRecords),
    items,
    list: items,
    records: items,
    total: items.length,
    queryMode: params.filters.queryMode,
    date: params.filters.date,
  };
}
