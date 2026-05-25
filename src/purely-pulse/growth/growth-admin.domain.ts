import { PartnerWithdrawalStatus } from '@prisma/client';
import type {
  GetPulseAdminPartnerApplicationsQueryDto,
  GetPulseAdminPayoutsQueryDto,
  PulseAdminPartnerApplicationsResponseDto,
  PulseAdminPayoutsResponseDto,
} from './dto/pulse-growth.dto';
import type {
  AdminPartnerApplicationRecord,
  AdminPayoutRecord,
  AdminPromoPartnerRecord,
} from './growth-admin.query';

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

type AdminPayoutStatus = 'pending' | 'paid' | 'rejected';
type AdminPartnerApplicationTab = GetPulseAdminPartnerApplicationsQueryDto['tab'];
type AdminPayoutTab = GetPulseAdminPayoutsQueryDto['tab'];
type PromoDateRange = {
  startAt: Date | null;
  endAt: Date | null;
};
type PromoMetricRecord = {
  recordAt: Date;
  chargedAmount: number;
};
type AdminPartnerApplicationItem = {
  id: string;
  name: string;
  phone: string;
  city: string;
  appliedAt: string;
  reason: string;
  avatar: string;
  status: 'pending' | 'approved' | 'rejected';
};
type AdminPayoutItem = {
  id: string;
  partnerName: string;
  partnerPhone: string;
  partnerCity: string;
  amount: number;
  accountType: AdminPayoutRecord['accountType'];
  accountNo: string;
  accountName: string;
  status: AdminPayoutStatus;
  appliedAt: string;
  paidAt: string | null;
  txnNo: string | null;
  rejectReason: string | null;
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

export function buildAdminPartnerApplicationsResponse(
  applications: AdminPartnerApplicationRecord[],
  tab?: AdminPartnerApplicationTab,
): PulseAdminPartnerApplicationsResponseDto {
  const items = applications.map((application) => mapAdminPartnerApplication(application));
  const filteredItems = filterAdminPartnerApplications(items, tab);

  return {
    items: filteredItems,
    pendingCount: items.filter((item) => item.status === 'pending').length,
    approvedCount: items.filter((item) => item.status === 'approved').length,
    rejectedCount: items.filter((item) => item.status === 'rejected').length,
  };
}

export function buildAdminPayoutsResponse(
  withdrawals: AdminPayoutRecord[],
  tab?: AdminPayoutTab,
): PulseAdminPayoutsResponseDto {
  const items = withdrawals.map((withdrawal) => mapAdminPayoutItem(withdrawal));
  const filteredItems = filterAdminPayouts(items, tab);
  const pendingItems = items.filter((item) => item.status === 'pending');
  const paidItems = items.filter((item) => item.status === 'paid');

  return {
    items: filteredItems,
    pendingCount: pendingItems.length,
    pendingTotal: pendingItems.reduce((sum, item) => sum + item.amount, 0),
    paidTotal: paidItems.reduce((sum, item) => sum + item.amount, 0),
  };
}

export function resolvePromoDateRange(rawQuery: Record<string, unknown>): PromoDateRange {
  const queryMode = typeof rawQuery.queryMode === 'string' ? rawQuery.queryMode : '';
  if (queryMode === 'day' && typeof rawQuery.date === 'string') {
    const day = parseDateOnly(rawQuery.date);
    if (!day) {
      return { startAt: null, endAt: null };
    }

    const startAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    const endAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    return { startAt, endAt };
  }

  if (queryMode === 'range') {
    const startAt =
      typeof rawQuery.startDate === 'string' ? parseDateOnly(rawQuery.startDate) : null;
    const endAt = typeof rawQuery.endDate === 'string' ? parseDateOnly(rawQuery.endDate) : null;

    return {
      startAt: startAt
        ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate(), 0, 0, 0, 0)
        : null,
      endAt: endAt
        ? new Date(endAt.getFullYear(), endAt.getMonth(), endAt.getDate(), 23, 59, 59, 999)
        : null,
    };
  }

  return { startAt: null, endAt: null };
}

function mapAdminPartnerApplication(
  application: AdminPartnerApplicationRecord,
): AdminPartnerApplicationItem {
  return {
    id: String(application.id),
    name: application.name,
    phone: maskPhone(application.phone),
    city: resolveRegionCity(application.region),
    appliedAt: formatDateTime(application.createdAt),
    reason: application.applyReason?.trim() || '暂无申请理由',
    avatar: application.name.trim().slice(0, 1) || '合',
    status: normalizePartnerApplicationStatus(application.status),
  };
}

function filterAdminPartnerApplications<T extends { status: AdminPartnerApplicationItem['status'] }>(
  items: T[],
  tab?: AdminPartnerApplicationTab,
): T[] {
  if (!tab || tab === 'all') {
    return items;
  }

  return items.filter((item) => item.status === tab);
}

function normalizePartnerApplicationStatus(
  status: string,
): AdminPartnerApplicationItem['status'] {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function mapAdminPayoutItem(withdrawal: AdminPayoutRecord): AdminPayoutItem {
  return {
    id: String(withdrawal.id),
    partnerName: withdrawal.partner.name?.trim() || '未命名合伙人',
    partnerPhone: maskPhone(withdrawal.partner.phone ?? ''),
    partnerCity: resolveRegionCity(withdrawal.partner.region),
    amount: withdrawal.rmbAmount,
    accountType: withdrawal.accountType,
    accountNo: withdrawal.accountNo,
    accountName: withdrawal.accountName,
    status: normalizeAdminPayoutStatus(withdrawal.status),
    appliedAt: formatDateTime(withdrawal.appliedAt),
    paidAt: withdrawal.paidAt ? formatDateTime(withdrawal.paidAt) : null,
    txnNo: null,
    rejectReason: withdrawal.rejectReason,
  };
}

function filterAdminPayouts<T extends { status: AdminPayoutItem['status'] }>(
  items: T[],
  tab?: AdminPayoutTab,
): T[] {
  if (!tab || tab === 'all') {
    return items;
  }

  return items.filter((item) => item.status === tab);
}

function normalizeAdminPayoutStatus(
  status: PartnerWithdrawalStatus,
): AdminPayoutItem['status'] {
  switch (status) {
    case PartnerWithdrawalStatus.paid:
      return 'paid';
    case PartnerWithdrawalStatus.rejected:
      return 'rejected';
    default:
      return 'pending';
  }
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
  const revenue = metrics.reduce((sum, record) => sum + record.chargedAmount, 0);

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

function buildPromoRegions(partners: AdminPromoPartnerItem[]): AdminPromoRegionItem[] {
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

function parseDateOnly(value: string): Date | null {
  const normalizedValue = value.trim().replace(/\./g, '-').replace(/\//g, '-');
  const matched = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }

  const [, yearText, monthText, dayText] = matched;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const parsedDate = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
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

function buildPromoSeriesLabel(date: Date, granularity: 'day' | 'month' | 'year'): string {
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

function resolveRegionCity(region: string[]): string {
  if (region.length >= 2) {
    return region[1] ?? region[0] ?? '--';
  }

  return region[0] ?? '--';
}

function maskPhone(phone: string): string {
  const normalizedPhone = phone.replace(/\s+/g, '');
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    return normalizedPhone || '--';
  }

  return `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`;
}

function formatDateTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return '--';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
