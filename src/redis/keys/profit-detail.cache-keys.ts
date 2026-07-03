import { toCacheSegment } from '../cache-keys.shared';

export type ProfitDetailCacheQuery = {
  period?: string;
  year?: number | null;
  customDate?: number | null;
  rangeStartDate?: number | null;
  rangeEndDate?: number | null;
  startTime?: number | null;
  endTime?: number | null;
  scope?: 'owner' | 'sub_account';
};

// ── Profit Detail 缓存键 ──

export function buildProfitDetailCacheKey(
  storeId: number,
  query: ProfitDetailCacheQuery,
): string {
  return [
    'profit:profit-detail',
    `store:${storeId}`,
    `scope:${query.scope ?? 'owner'}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
    `startTime:${toCacheSegment(query.startTime)}`,
    `endTime:${toCacheSegment(query.endTime)}`,
  ].join(':');
}

export function buildProfitDetailPattern(storeId: number): string {
  return `profit:profit-detail:store:${storeId}:*`;
}

export function buildProfitDetailAllPattern(): string {
  return 'profit:profit-detail:store:*';
}

// ── Profit Report 缓存键 ──

export function buildProfitReportCacheKey(
  storeId: number,
  query: ProfitDetailCacheQuery,
): string {
  return [
    'profit:profit-report',
    `store:${storeId}`,
    `scope:${query.scope ?? 'owner'}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
    `startTime:${toCacheSegment(query.startTime)}`,
    `endTime:${toCacheSegment(query.endTime)}`,
  ].join(':');
}

export function buildProfitReportPattern(storeId: number): string {
  return `profit:profit-report:store:${storeId}:*`;
}

export function buildProfitReportAllPattern(): string {
  return 'profit:profit-report:store:*';
}

// ── Parse 函数 ──

function parseProfitCacheKeyInternal(
  cacheKey: string,
  prefix: 'profit:profit-detail' | 'profit:profit-report',
): {
  storeId: number;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  startTime?: number;
  endTime?: number;
} | null {
  const match = new RegExp(
    `^${prefix}:store:(\\d+):scope:(owner|sub_account):period:([^:]+):year:([^:]+):customDate:([^:]+):rangeStart:([^:]+):rangeEnd:([^:]+):startTime:([^:]+):endTime:([^:]+)$`,
  ).exec(cacheKey);
  if (!match) {
    return null;
  }

  const [
    ,
    rawStoreId,
    ,
    rawPeriod,
    rawYear,
    rawCustomDate,
    rawRangeStart,
    rawRangeEnd,
    rawStartTime,
    rawEndTime,
  ] = match;

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod === 'na' ? undefined : rawPeriod,
    year: rawYear === 'na' ? undefined : Number(rawYear),
    customDate: rawCustomDate === 'na' ? undefined : Number(rawCustomDate),
    rangeStartDate: rawRangeStart === 'na' ? undefined : Number(rawRangeStart),
    rangeEndDate: rawRangeEnd === 'na' ? undefined : Number(rawRangeEnd),
    startTime: rawStartTime === 'na' ? undefined : Number(rawStartTime),
    endTime: rawEndTime === 'na' ? undefined : Number(rawEndTime),
  };
}

export function parseProfitDetailCacheKey(cacheKey: string): {
  storeId: number;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  startTime?: number;
  endTime?: number;
} | null {
  return parseProfitCacheKeyInternal(cacheKey, 'profit:profit-detail');
}

export function parseProfitReportCacheKey(cacheKey: string): {
  storeId: number;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  startTime?: number;
  endTime?: number;
} | null {
  return parseProfitCacheKeyInternal(cacheKey, 'profit:profit-report');
}
