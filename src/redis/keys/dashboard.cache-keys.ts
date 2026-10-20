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

/** 动态数据只按门店聚合（与周期无关），缓存键不带 period */
export function buildProfitDashboardHomeActivitiesCacheKey(
  storeId: number,
): string {
  return `profit:dashboard:home-chunk:activities:store:${storeId}`;
}

/**
 * 首页「能力快照」缓存键，必须带 userId。
 *
 * capability 依赖登录用户身份（子账号角色/配额/业态），不能进门店级共享缓存；
 * 它只驱动前端 UI 展示，安全裁决由 PermissionsGuard + resolveSingleStoreId 完成，
 * 因此允许一个短 TTL 的陈旧窗口。
 */
export function buildProfitDashboardHomeCapabilityCacheKey(
  userId: number,
  storeId: number,
): string {
  return `profit:dashboard:home-capability:user:${userId}:store:${storeId}`;
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
