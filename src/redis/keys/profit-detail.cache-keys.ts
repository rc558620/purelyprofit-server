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

/**
 * 按周期归一化缓存入参：只保留该周期真正参与区间计算的字段。
 *
 * 不归一化时，`{period:'year'}` 与 `{period:'year', startTime, endTime}` 会生成
 * 两个不同的 key（year 周期根本不读 startTime/endTime），首页预热写进的 key
 * 与详情页真实请求的 key 必然不同，缓存永远不命中。
 * custom_month / custom_range 的 startTime、endTime 与 customDate、rangeStart/rangeEnd
 * 是同一语义的两种入参，这里也收敛成唯一形式。
 */
export function normalizeProfitCacheQuery(
  query: ProfitDetailCacheQuery,
): ProfitDetailCacheQuery {
  const period = query.period ?? 'month';
  const scope = query.scope;

  if (period === 'custom_range') {
    return {
      period,
      scope,
      startTime: query.rangeStartDate ?? query.startTime ?? null,
      endTime: query.rangeEndDate ?? query.endTime ?? null,
    };
  }

  if (period === 'custom_month') {
    return {
      period,
      scope,
      customDate: query.customDate ?? query.startTime ?? null,
    };
  }

  if (period === 'year') {
    return { period, scope, year: query.year ?? null };
  }

  return { period, scope };
}

export function buildProfitDetailCacheKey(
  storeId: number,
  query: ProfitDetailCacheQuery,
): string {
  const normalized = normalizeProfitCacheQuery(query);
  return [
    'profit:profit-detail',
    `store:${storeId}`,
    `scope:${normalized.scope ?? 'owner'}`,
    `period:${toCacheSegment(normalized.period)}`,
    `year:${toCacheSegment(normalized.year)}`,
    `customDate:${toCacheSegment(normalized.customDate)}`,
    `rangeStart:${toCacheSegment(normalized.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(normalized.rangeEndDate)}`,
    `startTime:${toCacheSegment(normalized.startTime)}`,
    `endTime:${toCacheSegment(normalized.endTime)}`,
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
  const normalized = normalizeProfitCacheQuery(query);
  return [
    'profit:profit-report',
    `store:${storeId}`,
    `scope:${normalized.scope ?? 'owner'}`,
    `period:${toCacheSegment(normalized.period)}`,
    `year:${toCacheSegment(normalized.year)}`,
    `customDate:${toCacheSegment(normalized.customDate)}`,
    `rangeStart:${toCacheSegment(normalized.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(normalized.rangeEndDate)}`,
    `startTime:${toCacheSegment(normalized.startTime)}`,
    `endTime:${toCacheSegment(normalized.endTime)}`,
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
