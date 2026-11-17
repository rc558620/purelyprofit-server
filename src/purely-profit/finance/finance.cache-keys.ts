import { toCacheSegment } from '../../redis/cache-keys.shared';
import {
  FINANCE_OVERVIEW_PERIOD_VALUES,
  type FinanceAccountsListQueryInput,
  type FinanceCashFlowListQueryInput,
  type FinanceOverviewPeriodValue,
  type FinanceReconciliationsListQueryInput,
} from './finance.types';

export type FinanceCashFlowCacheKeyQuery = FinanceCashFlowListQueryInput & {
  scope: 'owner' | 'sub_account';
};

type FinanceReportCacheQuery = {
  period?: string;
  year?: number | null;
  customDate?: number | null;
  rangeStartDate?: number | null;
  rangeEndDate?: number | null;
  scope?: 'owner' | 'sub_account';
};

function isFinanceOverviewPeriodValue(
  value: string,
): value is FinanceOverviewPeriodValue {
  return (FINANCE_OVERVIEW_PERIOD_VALUES as readonly string[]).includes(value);
}

export function buildFinanceOverviewCacheKey(
  storeId: number,
  period: string,
  scope: 'owner' | 'sub_account' = 'owner',
): string {
  return `profit:finance:overview:store:${storeId}:period:${period}:scope:${scope}`;
}

export function buildFinanceOverviewPattern(storeId: number): string {
  return `profit:finance:overview:store:${storeId}:period:*`;
}

export function buildFinanceOverviewAllPattern(): string {
  return `profit:finance:overview:store:*:period:*`;
}

/**
 * 流水列表与统计共用的筛选段。
 *
 * 两处 key 的筛选段必须逐字一致，否则同一份筛选条件会被拆成两个缓存域；
 * 提成单点后新增筛选项只需改这里，避免「列表生效、统计不生效」的口径漂移。
 */
function buildCashFlowFilterSegments(
  query: FinanceCashFlowCacheKeyQuery,
): string[] {
  return [
    `scope:${query.scope}`,
    `period:${toCacheSegment(query.period)}`,
    `direction:${toCacheSegment(query.directionFilter ?? 'all')}`,
    `customDayYear:${toCacheSegment(query.customDayYear)}`,
    `customDayMonth:${toCacheSegment(query.customDayMonth)}`,
    `customDayDay:${toCacheSegment(query.customDayDay)}`,
    `customRangeStartYear:${toCacheSegment(query.customRangeStartYear)}`,
    `customRangeStartMonth:${toCacheSegment(query.customRangeStartMonth)}`,
    `customRangeStartDay:${toCacheSegment(query.customRangeStartDay)}`,
    `customRangeEndYear:${toCacheSegment(query.customRangeEndYear)}`,
    `customRangeEndMonth:${toCacheSegment(query.customRangeEndMonth)}`,
    `customRangeEndDay:${toCacheSegment(query.customRangeEndDay)}`,
  ];
}

export function buildFinanceCashFlowListCacheKey(
  storeId: number,
  query: FinanceCashFlowCacheKeyQuery,
): string {
  return [
    'profit:finance:cash-flow:list',
    `store:${storeId}`,
    ...buildCashFlowFilterSegments(query),
    `page:${toCacheSegment(query.page)}`,
    `pageSize:${toCacheSegment(query.pageSize)}`,
  ].join(':');
}

export function buildFinanceCashFlowStatsCacheKey(
  storeId: number,
  query: FinanceCashFlowCacheKeyQuery,
): string {
  return [
    'profit:finance:cash-flow:stats',
    `store:${storeId}`,
    ...buildCashFlowFilterSegments(query),
  ].join(':');
}

export function buildFinanceCashFlowPattern(storeId: number): string {
  return `profit:finance:cash-flow:*:store:${storeId}:*`;
}

export function buildFinanceAccountsListCacheKey(
  storeId: number,
  query: FinanceAccountsListQueryInput,
): string {
  return [
    'profit:finance:accounts:list',
    `store:${storeId}`,
    `type:${toCacheSegment(query.typeFilter ?? 'all')}`,
    `status:${toCacheSegment(query.statusFilter ?? 'all')}`,
    `search:${toCacheSegment(query.searchText)}`,
    `datePeriod:${toCacheSegment(query.datePeriod ?? 'all')}`,
    `cDay:${toCacheSegment(query.customDayYear)}-${toCacheSegment(query.customDayMonth)}-${toCacheSegment(query.customDayDay)}`,
    `cRange:${toCacheSegment(query.customRangeStartYear)}-${toCacheSegment(query.customRangeStartMonth)}-${toCacheSegment(query.customRangeStartDay)}`,
    `to:${toCacheSegment(query.customRangeEndYear)}-${toCacheSegment(query.customRangeEndMonth)}-${toCacheSegment(query.customRangeEndDay)}`,
    `page:${toCacheSegment(query.page)}`,
    `pageSize:${toCacheSegment(query.pageSize)}`,
  ].join(':');
}

export function buildFinanceAccountsStatsCacheKey(storeId: number): string {
  return `profit:finance:accounts:stats:store:${storeId}`;
}

export function buildFinanceAccountsPattern(storeId: number): string {
  return `profit:finance:accounts:*:store:${storeId}*`;
}

export function buildFinanceReconciliationsListCacheKey(
  storeId: number,
  query: FinanceReconciliationsListQueryInput,
): string {
  return [
    'profit:finance:reconciliations:list',
    `store:${storeId}`,
    `status:${toCacheSegment(query.statusFilter ?? 'all')}`,
    `type:${toCacheSegment(query.typeFilter ?? 'all')}`,
    `search:${toCacheSegment(query.searchText)}`,
    `page:${toCacheSegment(query.page)}`,
    `pageSize:${toCacheSegment(query.pageSize)}`,
  ].join(':');
}

export function buildFinanceReconciliationsStatsCacheKey(
  storeId: number,
): string {
  return `profit:finance:reconciliations:stats:store:${storeId}`;
}

export function buildFinanceReconciliationsPattern(storeId: number): string {
  return `profit:finance:reconciliations:*:store:${storeId}*`;
}

/**
 * 报表缓存的两段载荷。
 *
 * 一个 key 同时装 summary + 明细行时，单 key 约 940 KB，summary 每次刷新都要
 * 整体重写一遍；拆成两个 part 后 summary 只有 7 个数字，明细行可用独立（更短）TTL。
 *
 * 两个 part 共用同一段前缀（`profit:finance:report:store:<id>:...`），
 * 因此 `buildFinanceReportPattern` / `buildFinanceReportAllPattern` 的失效范围
 * **天然覆盖两者**，失效链路无需额外改动。
 */
export type FinanceReportCachePart = 'summary' | 'rows';

export function buildFinanceReportCacheKey(
  storeId: number,
  query: FinanceReportCacheQuery,
  part: FinanceReportCachePart,
): string {
  return [
    'profit:finance:report',
    `store:${storeId}`,
    `scope:${query.scope ?? 'owner'}`,
    `period:${toCacheSegment(query.period)}`,
    `year:${toCacheSegment(query.year)}`,
    `customDate:${toCacheSegment(query.customDate)}`,
    `rangeStart:${toCacheSegment(query.rangeStartDate)}`,
    `rangeEnd:${toCacheSegment(query.rangeEndDate)}`,
    `part:${part}`,
  ].join(':');
}

export function buildFinanceReportPattern(storeId: number): string {
  return `profit:finance:report:store:${storeId}:*`;
}

export function buildFinanceReportAllPattern(): string {
  return 'profit:finance:report:store:*';
}

/** 报表缓存 key 的解析结果：供预热按门店收敛与按 part 定向重建 */
export type ParsedFinanceReportCacheKey = {
  storeId: number;
  scope: 'owner' | 'sub_account';
  part: FinanceReportCachePart;
  period?: string;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
};

/**
 * 解析报表缓存 key（预热链路唯一入口）。
 *
 * 正则只有这一份：key 结构一旦变化（例如再加一段），
 * 预热与失效不会各自漂移——解析失败只会让该 key 不被预热，不会误删或错配。
 */
export function parseFinanceReportCacheKey(
  cacheKey: string,
): ParsedFinanceReportCacheKey | null {
  const match =
    /^profit:finance:report:store:(\d+):scope:(owner|sub_account):period:([^:]+):year:([^:]+):customDate:([^:]+):rangeStart:([^:]+):rangeEnd:([^:]+):part:(summary|rows)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [
    ,
    rawStoreId,
    rawScope,
    rawPeriod,
    rawYear,
    rawCustomDate,
    rawRangeStart,
    rawRangeEnd,
    rawPart,
  ] = match;

  return {
    storeId: Number(rawStoreId),
    scope: rawScope as 'owner' | 'sub_account',
    part: rawPart as FinanceReportCachePart,
    period: rawPeriod === 'na' ? undefined : rawPeriod,
    year: rawYear === 'na' ? undefined : Number(rawYear),
    customDate: rawCustomDate === 'na' ? undefined : Number(rawCustomDate),
    rangeStartDate: rawRangeStart === 'na' ? undefined : Number(rawRangeStart),
    rangeEndDate: rawRangeEnd === 'na' ? undefined : Number(rawRangeEnd),
  };
}

export function parseFinanceOverviewCacheKey(cacheKey: string): {
  storeId: number;
  period: FinanceOverviewPeriodValue;
  scope: 'owner' | 'sub_account';
} | null {
  const match =
    /^profit:finance:overview:store:(\d+):period:(.+):scope:(owner|sub_account)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod, rawScope] = match;
  if (!isFinanceOverviewPeriodValue(rawPeriod)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
    scope: rawScope as 'owner' | 'sub_account',
  };
}
