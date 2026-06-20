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

function isFinanceOverviewPeriodValue(
  value: string,
): value is FinanceOverviewPeriodValue {
  return (FINANCE_OVERVIEW_PERIOD_VALUES as readonly string[]).includes(value);
}

function toCacheSegment(value: string | number | null | undefined): string {
  return encodeURIComponent(String(value ?? 'na'));
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

export function buildFinanceCashFlowListCacheKey(
  storeId: number,
  query: FinanceCashFlowCacheKeyQuery,
): string {
  return [
    'profit:finance:cash-flow:list',
    `store:${storeId}`,
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
