import { toCacheSegment } from '../cache-keys.shared';

type CostsStatsCacheQuery = {
  period?: string;
  typeFilter?: string;
  customDate?: number | null;
  rangeStartDate?: number | null;
  rangeEndDate?: number | null;
};

type CostsReportCacheQuery = {
  period?: string;
  year?: number | null;
  customDate?: number | null;
  rangeStartDate?: number | null;
  rangeEndDate?: number | null;
  categoryFilter?: string;
};

type CostsRecordsCacheQuery = {
  period?: string;
  typeFilter?: string;
  customDate?: number | null;
  rangeStartDate?: number | null;
  rangeEndDate?: number | null;
};

// ── Costs Stats 缓存键 ──

export function buildCostsStatsCacheKey(
  storeId: number,
  query: CostsStatsCacheQuery,
): string {
  return [
    'profit:costs:stats',
    `store:${storeId}`,
    `period:${toCacheSegment(query.period)}`,
    `typeFilter:${toCacheSegment(query.typeFilter)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildCostsStatsPattern(storeId: number): string {
  return `profit:costs:stats:store:${storeId}:*`;
}

// ── Costs Report 缓存键 ──

export function buildCostsReportCacheKey(
  storeId: number,
  query: CostsReportCacheQuery,
): string {
  return [
    'profit:costs:report',
    `store:${storeId}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
    `category:${toCacheSegment(query.categoryFilter)}`,
  ].join(':');
}

export function buildCostsReportPattern(storeId: number): string {
  return `profit:costs:report:store:${storeId}:*`;
}

export function buildCostsReportAllPattern(): string {
  return 'profit:costs:report:store:*';
}

// ── Costs Records 缓存键 ──

export function buildCostsRecordsCacheKey(
  storeId: number,
  query: CostsRecordsCacheQuery,
): string {
  return [
    'profit:costs:records',
    `store:${storeId}`,
    `period:${toCacheSegment(query.period)}`,
    `typeFilter:${toCacheSegment(query.typeFilter)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildCostsRecordsPattern(storeId: number): string {
  return `profit:costs:records:store:${storeId}:*`;
}

export function buildCostsAllPattern(): string {
  return 'profit:costs:*:store:*';
}

// ── Costs Dashboard 缓存键 ──

export function buildCostsDashboardCacheKey(
  storeId: number,
  query: CostsStatsCacheQuery,
): string {
  return [
    'profit:costs:dashboard',
    `store:${storeId}`,
    `period:${toCacheSegment(query.period)}`,
    `typeFilter:${toCacheSegment(query.typeFilter)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildCostsDashboardPattern(storeId: number): string {
  return `profit:costs:dashboard:store:${storeId}:*`;
}
