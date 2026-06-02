import type { AdminPromoPartnerRecord } from './growth-admin.query';
import { formatDateTime, parseDateOnly } from './growth-admin.shared';

export interface PulseAdminPromoDetailResponse {
  regions: Array<{
    province: string;
    city?: string;
    partnerCount: number;
    totalOrders: number;
    totalRevenue: number;
    growth: number;
  }>;
  partners: Array<{
    id: string;
    name: string;
    province: string;
    city: string;
    district?: string;
    orders: number;
    revenue: number;
    growth: number;
    avatar: string;
    rank: number;
    joinDate: string;
    phone: string;
    series: {
      day: Array<{
        label: string;
        orders: number;
        revenue: number;
      }>;
      month: Array<{
        label: string;
        orders: number;
        revenue: number;
      }>;
      year: Array<{
        label: string;
        orders: number;
        revenue: number;
      }>;
    };
  }>;
}

type PromoDateRange = {
  startAt: Date | null;
  endAt: Date | null;
};

type PromoMetricRecord = {
  recordAt: Date;
  chargedAmount: number;
};

type AdminPromoPeriodRecord = {
  label: string;
  orders: number;
  revenue: number;
};

type AdminPromoPartnerItem = PulseAdminPromoDetailResponse['partners'][number];
type AdminPromoRegionItem = PulseAdminPromoDetailResponse['regions'][number];

export function buildAdminPromoDetailResponse(
  partners: AdminPromoPartnerRecord[],
  dateRange: PromoDateRange,
): PulseAdminPromoDetailResponse {
  const partnerItems = partners
    .map((partner) => mapAdminPromoPartner(partner, dateRange))
    .sort((left, right) => {
      if (right.revenue !== left.revenue) {
        return right.revenue - left.revenue;
      }
      return right.orders - left.orders;
    })
    .map((partner, index) => ({
      ...partner,
      rank: index + 1,
    }));

  return {
    regions: buildPromoRegions(partnerItems),
    partners: partnerItems,
  };
}

export function resolvePromoDateRange(
  rawQuery: Record<string, unknown>,
): PromoDateRange {
  const queryMode =
    typeof rawQuery.queryMode === 'string' ? rawQuery.queryMode : '';
  if (queryMode === 'day' && typeof rawQuery.date === 'string') {
    const day = parseDateOnly(rawQuery.date);
    if (!day) {
      return { startAt: null, endAt: null };
    }

    return {
      startAt: buildDayBoundary(day, 'start'),
      endAt: buildDayBoundary(day, 'end'),
    };
  }

  if (queryMode === 'range') {
    const startAt =
      typeof rawQuery.startDate === 'string'
        ? parseDateOnly(rawQuery.startDate)
        : null;
    const endAt =
      typeof rawQuery.endDate === 'string'
        ? parseDateOnly(rawQuery.endDate)
        : null;

    return {
      startAt: startAt ? buildDayBoundary(startAt, 'start') : null,
      endAt: endAt ? buildDayBoundary(endAt, 'end') : null,
    };
  }

  return { startAt: null, endAt: null };
}

function mapAdminPromoPartner(
  partner: AdminPromoPartnerRecord,
  dateRange: PromoDateRange,
): AdminPromoPartnerItem {
  const metrics = partner.store.membershipPromoRecords
    .map((record) => toPromoMetricRecord(record))
    .filter((record): record is PromoMetricRecord => record !== null)
    .filter((record) => matchesPromoDateRange(record.recordAt, dateRange));

  const series = {
    day: buildPromoSeries(metrics, 'day'),
    month: buildPromoSeries(metrics, 'month'),
    year: buildPromoSeries(metrics, 'year'),
  };
  const partnerName =
    partner.name?.trim() ||
    partner.store.owner.name?.trim() ||
    partner.store.name.trim() ||
    `商家 ${partner.storeId}`;
  const province = partner.region[0] ?? '';
  const city = (partner.region[1] ?? province) || '未知';
  const district = partner.region[2] ?? undefined;
  const revenue = metrics.reduce(
    (sum, record) => sum + record.chargedAmount,
    0,
  );

  return {
    id: String(partner.storeId),
    name: partnerName,
    province,
    city,
    district,
    orders: metrics.length,
    revenue,
    growth: 0,
    avatar: partnerName.slice(0, 1) || '合',
    rank: 0,
    joinDate: formatDateTime(partner.joinedAt ?? new Date(0)),
    phone: partner.phone?.trim() || '--',
    series,
  };
}

function buildPromoRegions(
  partners: AdminPromoPartnerItem[],
): AdminPromoRegionItem[] {
  const regionMap = new Map<string, AdminPromoRegionItem>();

  partners.forEach((partner) => {
    const province = partner.province || partner.city || '未知地区';
    const existing = regionMap.get(province);
    if (existing) {
      existing.partnerCount += 1;
      existing.totalOrders += partner.orders;
      existing.totalRevenue += partner.revenue;
      existing.growth = Math.max(existing.growth, partner.growth);
      return;
    }

    regionMap.set(province, {
      province,
      city: undefined,
      partnerCount: 1,
      totalOrders: partner.orders,
      totalRevenue: partner.revenue,
      growth: partner.growth,
    });
  });

  return [...regionMap.values()].sort((left, right) => {
    if (right.partnerCount !== left.partnerCount) {
      return right.partnerCount - left.partnerCount;
    }
    return right.totalRevenue - left.totalRevenue;
  });
}

function buildDayBoundary(date: Date, side: 'start' | 'end'): Date {
  if (side === 'start') {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function toPromoMetricRecord(record: {
  chargedAmount: number | null;
  chargedAt: Date | null;
  registeredAt: Date;
}): PromoMetricRecord | null {
  const recordAt = record.chargedAt ?? record.registeredAt;
  if (!recordAt) {
    return null;
  }

  return {
    recordAt,
    chargedAmount: record.chargedAmount ?? 0,
  };
}

function matchesPromoDateRange(date: Date, range: PromoDateRange): boolean {
  if (range.startAt && date.getTime() < range.startAt.getTime()) {
    return false;
  }

  if (range.endAt && date.getTime() > range.endAt.getTime()) {
    return false;
  }

  return true;
}

function buildPromoSeries(
  metrics: PromoMetricRecord[],
  granularity: 'day' | 'month' | 'year',
): AdminPromoPeriodRecord[] {
  const bucketMap = new Map<string, AdminPromoPeriodRecord>();

  metrics.forEach((metric) => {
    const label = buildPromoSeriesLabel(metric.recordAt, granularity);
    const current = bucketMap.get(label);
    if (current) {
      current.orders += 1;
      current.revenue += metric.chargedAmount;
      return;
    }

    bucketMap.set(label, {
      label,
      orders: 1,
      revenue: metric.chargedAmount,
    });
  });

  return [...bucketMap.values()].sort((left, right) => {
    const leftTs = parsePromoSeriesLabel(left.label, granularity);
    const rightTs = parsePromoSeriesLabel(right.label, granularity);
    return leftTs - rightTs;
  });
}

function buildPromoSeriesLabel(
  date: Date,
  granularity: 'day' | 'month' | 'year',
): string {
  if (granularity === 'year') {
    return `${date.getFullYear()}年`;
  }

  if (granularity === 'month') {
    return `${date.getMonth() + 1}月`;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function parsePromoSeriesLabel(
  label: string,
  granularity: 'day' | 'month' | 'year',
): number {
  if (granularity === 'year' || granularity === 'month') {
    return Number.parseInt(label, 10) || 0;
  }

  const [monthText, dayText] = label.split('/');
  const month = Number.parseInt(monthText, 10) || 0;
  const day = Number.parseInt(dayText, 10) || 0;
  return month * 100 + day;
}
