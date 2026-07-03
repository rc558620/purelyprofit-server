import { toCacheSegment } from '../cache-keys.shared';

type SalesDerivedCacheQuery = {
  scope: 'owner' | 'sub_account';
  period?: string;
  year?: number;
  customDate?: string;
  rangeStartDate?: string;
  rangeEndDate?: string;
};

export function buildSalesStatsCacheKey(
  storeId: number,
  query: SalesDerivedCacheQuery,
): string {
  return [
    'profit:sales:stats',
    `store:${storeId}`,
    `scope:${query.scope}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `start:${toCacheSegment(query.rangeStartDate)}`,
    `end:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildSalesStatsPattern(storeId: number): string {
  return `profit:sales:stats:store:${storeId}:*`;
}

export function buildSalesReportCacheKey(
  storeId: number,
  query: SalesDerivedCacheQuery,
): string {
  return [
    'profit:sales:report',
    `store:${storeId}`,
    `scope:${query.scope}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `start:${toCacheSegment(query.rangeStartDate)}`,
    `end:${toCacheSegment(query.rangeEndDate)}`,
  ].join(':');
}

export function buildSalesReportPattern(storeId: number): string {
  return `profit:sales:report:store:${storeId}:*`;
}
