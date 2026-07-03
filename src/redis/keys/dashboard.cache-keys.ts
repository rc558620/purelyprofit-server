import {
  DASHBOARD_HOME_PERIOD_VALUES,
  type DashboardHomePeriodValue,
} from '../../purely-profit/dashboard/dashboard-home/dashboard-home.types';

function isDashboardHomePeriodValue(
  value: string,
): value is DashboardHomePeriodValue {
  return (DASHBOARD_HOME_PERIOD_VALUES as readonly string[]).includes(value);
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
