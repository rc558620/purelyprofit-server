import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  type BusinessAnalysisPeriod,
} from '../purely-profit/dashboard/business-analysis/business-analysis.types';
import {
  DASHBOARD_HOME_PERIOD_VALUES,
  type DashboardHomePeriodValue,
} from '../purely-profit/dashboard/dashboard-home/dashboard-home.types';

export {
  buildFinanceAccountsListCacheKey,
  buildFinanceAccountsPattern,
  buildFinanceAccountsStatsCacheKey,
  buildFinanceCashFlowListCacheKey,
  buildFinanceCashFlowPattern,
  buildFinanceCashFlowStatsCacheKey,
  buildFinanceOverviewAllPattern,
  buildFinanceOverviewCacheKey,
  buildFinanceOverviewPattern,
  buildFinanceReconciliationsListCacheKey,
  buildFinanceReconciliationsPattern,
  buildFinanceReconciliationsStatsCacheKey,
  parseFinanceOverviewCacheKey,
} from '../purely-profit/finance/finance.cache-keys';
export {
  buildPulseDashboardHomeCacheKey,
  buildPulseDashboardHomePattern,
  buildPulseDashboardOverviewCacheKey,
  buildPulseDashboardOverviewPattern,
  buildPulseDashboardRevenueDetailCacheKey,
  buildPulseDashboardRevenueDetailPattern,
  buildPulseGrowthAdminPartnerApplicationsCacheKey,
  buildPulseGrowthAdminPattern,
  buildPulseGrowthAdminPayoutsCacheKey,
  buildPulseGrowthEarningsLogsCacheKey,
  buildPulseGrowthEarningsOverviewCacheKey,
  buildPulseGrowthEarningsPattern,
  buildPulseOnboardingStatusCacheKey,
  buildPulseOnboardingStatusCacheKeyFromQuery,
  buildPulseOnboardingStatusPatternByStore,
  buildPulseOnboardingStatusPatternByUser,
  buildPulseSessionBootstrapCacheKey,
  buildPulseSessionBootstrapCacheKeyFromQuery,
  buildPulseSessionBootstrapPatternByStore,
  buildPulseSessionBootstrapPatternByUser,
  buildPulseSessionNotificationCacheKey,
} from '../purely-pulse/pulse.cache-keys';

type BusinessAnalysisCacheQuery = {
  period?: string | null;
  startTime?: number | null;
  endTime?: number | null;
};

type MembersListCacheQuery = {
  status?: string;
  level?: string;
  keyword?: string;
  partner?: boolean;
  page: number;
  pageSize: number;
};

type WithdrawalsListCacheQuery = {
  status?: string;
};

type SalesDerivedCacheQuery = {
  scope: 'owner' | 'sub_account';
  period?: string;
  year?: number;
  customDate?: string;
  rangeStartDate?: string;
  rangeEndDate?: string;
};

function isDashboardHomePeriodValue(
  value: string,
): value is DashboardHomePeriodValue {
  return (DASHBOARD_HOME_PERIOD_VALUES as readonly string[]).includes(value);
}

function isBusinessAnalysisPeriod(
  value: string,
): value is BusinessAnalysisPeriod {
  return (BUSINESS_ANALYSIS_PERIOD_VALUES as readonly string[]).includes(value);
}

function toCacheSegment(value: string | number | null | undefined): string {
  return encodeURIComponent(String(value ?? 'na'));
}

export function buildCacheRefreshTaskKey(cacheKey: string): string {
  return `refresh:${cacheKey}`;
}

export function buildProfitDashboardHomeCacheKey(
  storeId: number,
  period: string,
): string {
  return `profit:dashboard:home:store:${storeId}:period:${period}`;
}

export function buildProfitDashboardHomeStatsCacheKey(
  storeId: number,
  period: string,
): string {
  return `profit:dashboard:home-chunk:stats:store:${storeId}:period:${period}`;
}

export function buildProfitDashboardHomeTrendCacheKey(
  storeId: number,
  period: string,
): string {
  return `profit:dashboard:home-chunk:trend:store:${storeId}:period:${period}`;
}

export function buildProfitDashboardHomeActivitiesCacheKey(
  storeId: number,
  period: string,
): string {
  return `profit:dashboard:home-chunk:activities:store:${storeId}:period:${period}`;
}

export function buildProfitDashboardHomePattern(storeId: number): string {
  return `profit:dashboard:home:store:${storeId}:period:*`;
}

export function buildProfitDashboardHomeChunkPattern(storeId: number): string {
  return `profit:dashboard:home-chunk:*:store:${storeId}:period:*`;
}

export function buildProfitDashboardHomeAllPattern(): string {
  return 'profit:dashboard:home:store:*:period:*';
}

export function buildBusinessAnalysisCacheKey(
  storeId: number,
  query: BusinessAnalysisCacheQuery,
): string {
  return [
    'profit:business-analysis',
    `store:${storeId}`,
    `period:${query.period}`,
    `start:${query.startTime ?? 'na'}`,
    `end:${query.endTime ?? 'na'}`,
  ].join(':');
}

export function buildBusinessAnalysisPattern(storeId: number): string {
  return `profit:business-analysis:store:${storeId}:*`;
}

export function buildBusinessAnalysisAllPattern(): string {
  return 'profit:business-analysis:store:*:period:*:start:*:end:*';
}

export function buildMarketingOverviewCacheKey(storeId: number): string {
  return `profit:marketing:overview:store:${storeId}`;
}

export function buildMarketingOverviewPattern(storeId: number): string {
  return `profit:marketing:overview:store:${storeId}`;
}

export function buildMarketingOverviewAllPattern(): string {
  return 'profit:marketing:overview:store:*';
}

export function buildMembersListCacheKey(
  storeId: number,
  query: MembersListCacheQuery,
): string {
  return [
    'profit:members:list',
    `store:${storeId}`,
    `status:${query.status ?? 'all'}`,
    `level:${query.level ?? 'all'}`,
    `keyword:${encodeURIComponent(query.keyword ?? 'na')}`,
    `partner:${query.partner === true ? 'true' : 'all'}`,
    `page:${query.page}`,
    `pageSize:${query.pageSize}`,
  ].join(':');
}

export function buildMembersListPattern(storeId: number): string {
  return `profit:members:list:store:${storeId}:*`;
}

export function buildMembersMetaCacheKey(storeId: number): string {
  return `profit:members:meta:store:${storeId}`;
}

export function buildMembersMetaPattern(storeId: number): string {
  return `profit:members:meta:store:${storeId}`;
}

export function buildMembersMetaAllPattern(): string {
  return 'profit:members:meta:store:*';
}

export function buildMembersOverviewCacheKey(storeId: number): string {
  return `profit:members:overview:store:${storeId}`;
}

export function buildMembersOverviewPattern(storeId: number): string {
  return `profit:members:overview:store:${storeId}`;
}

export function buildMembersOverviewAllPattern(): string {
  return 'profit:members:overview:store:*';
}

export function buildWithdrawalsOverviewCacheKey(storeId: number): string {
  return `profit:withdrawals:overview:store:${storeId}`;
}

export function buildWithdrawalsListCacheKey(
  storeId: number,
  query: WithdrawalsListCacheQuery,
): string {
  return `profit:withdrawals:list:store:${storeId}:status:${query.status ?? 'all'}`;
}

export function buildWithdrawalsListPattern(storeId: number): string {
  return `profit:withdrawals:list:store:${storeId}:status:*`;
}

export function buildPlatformMembershipCenterCacheKey(storeId: number): string {
  return `profit:platform-membership:center:store:${storeId}`;
}

export function buildPlatformMembershipProfileCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:profile:store:${storeId}`;
}

export function buildPlatformMembershipOrdersCacheKey(storeId: number): string {
  return `profit:platform-membership:orders:store:${storeId}`;
}

export function buildPlatformMembershipPointsLogsCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:points-logs:store:${storeId}`;
}

export function buildPlatformMembershipBeanLogsCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:bean-logs:store:${storeId}`;
}

export function buildPlatformMembershipPromoCenterCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:promo-center:store:${storeId}`;
}

export function buildPlatformMembershipPartnerProfileCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:partner-profile:store:${storeId}`;
}

export function buildPlatformMembershipDerivedPattern(storeId: number): string {
  return `profit:platform-membership:*:store:${storeId}*`;
}

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

export function parseProfitDashboardHomeCacheKey(cacheKey: string): {
  storeId: number;
  period: DashboardHomePeriodValue;
} | null {
  const match = /^profit:dashboard:home:store:(\d+):period:(.+)$/.exec(
    cacheKey,
  );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod] = match;
  if (!isDashboardHomePeriodValue(rawPeriod)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
  };
}

export function parseMarketingOverviewCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:marketing:overview:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

export function parseMembersMetaCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:members:meta:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

export function parseMembersOverviewCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:members:overview:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

export function parseBusinessAnalysisCacheKey(cacheKey: string): {
  storeId: number;
  period: BusinessAnalysisPeriod;
  startTime?: number;
  endTime?: number;
} | null {
  const match =
    /^profit:business-analysis:store:(\d+):period:([^:]+):start:([^:]+):end:([^:]+)$/.exec(
      cacheKey,
    );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod, rawStartTime, rawEndTime] = match;
  if (!isBusinessAnalysisPeriod(rawPeriod)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
    startTime: rawStartTime === 'na' ? undefined : Number(rawStartTime),
    endTime: rawEndTime === 'na' ? undefined : Number(rawEndTime),
  };
}

export function buildMarketingPromotionsListCacheKey(
  storeId: number,
  status: string,
  page: number,
  pageSize: number,
): string {
  return `profit:marketing:promotions:list:store:${storeId}:status:${status}:page:${page}:pageSize:${pageSize}`;
}

export function buildMarketingPromotionsListPattern(storeId: number): string {
  return `profit:marketing:promotions:list:store:${storeId}:*`;
}

export function buildMarketingCustomersListCacheKey(
  storeId: number,
  status: string,
  tier: string,
  keyword: string,
  page: number,
  pageSize: number,
): string {
  return [
    'profit:marketing:customers:list',
    `store:${storeId}`,
    `status:${status}`,
    `tier:${tier}`,
    `keyword:${encodeURIComponent(keyword || 'na')}`,
    `page:${page}`,
    `pageSize:${pageSize}`,
  ].join(':');
}

export function buildMarketingCustomersListPattern(storeId: number): string {
  return `profit:marketing:customers:list:store:${storeId}:*`;
}
