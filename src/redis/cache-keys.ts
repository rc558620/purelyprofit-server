import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  type BusinessAnalysisPeriod,
} from '../purely-profit/dashboard/business-analysis/business-analysis.types';
import {
  DASHBOARD_HOME_PERIOD_VALUES,
  type DashboardHomePeriodValue,
} from '../purely-profit/dashboard/dashboard-home/dashboard-home.types';
import {
  FINANCE_OVERVIEW_PERIOD_VALUES,
  type FinanceOverviewPeriodValue,
} from '../purely-profit/finance/finance.types';

type BusinessAnalysisCacheQuery = {
  period?: string | null;
  startTime?: number | null;
  endTime?: number | null;
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

function isFinanceOverviewPeriodValue(
  value: string,
): value is FinanceOverviewPeriodValue {
  return (FINANCE_OVERVIEW_PERIOD_VALUES as readonly string[]).includes(value);
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

export function buildProfitDashboardHomePattern(storeId: number): string {
  return `profit:dashboard:home:store:${storeId}:period:*`;
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

export function buildFinanceOverviewCacheKey(
  storeId: number,
  period: string,
): string {
  return `profit:finance:overview:store:${storeId}:period:${period}`;
}

export function buildFinanceOverviewPattern(storeId: number): string {
  return `profit:finance:overview:store:${storeId}:period:*`;
}

export function buildFinanceOverviewAllPattern(): string {
  return 'profit:finance:overview:store:*:period:*';
}

export function buildMarketingOverviewCacheKey(storeId: number): string {
  return `profit:marketing:overview:store:${storeId}`;
}

export function buildPulseSessionNotificationCacheKey(storeId: number): string {
  return `pulse:session:notifications:store:${storeId}`;
}

export function buildPulseSessionBootstrapCacheKey(
  userId: number,
  mode: string,
  targetStoreId: number | null,
): string {
  return `pulse:session:bootstrap:user:${userId}:mode:${mode}:store:${targetStoreId ?? 'none'}`;
}

export function buildPulseSessionBootstrapPatternByStore(
  storeId: number,
): string {
  return `pulse:session:bootstrap:user:*:mode:*:store:${storeId}`;
}

export function buildPulseDashboardHomeCacheKey(
  revenuePeriod: string,
  region: string | undefined,
): string {
  return `pulse:dashboard:home:period:${revenuePeriod}:region:${encodeURIComponent(region ?? 'all')}`;
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

export function parseFinanceOverviewCacheKey(cacheKey: string): {
  storeId: number;
  period: FinanceOverviewPeriodValue;
} | null {
  const match = /^profit:finance:overview:store:(\d+):period:(.+)$/.exec(
    cacheKey,
  );
  if (!match) {
    return null;
  }

  const [, rawStoreId, rawPeriod] = match;
  if (!isFinanceOverviewPeriodValue(rawPeriod)) {
    return null;
  }

  return {
    storeId: Number(rawStoreId),
    period: rawPeriod,
  };
}
