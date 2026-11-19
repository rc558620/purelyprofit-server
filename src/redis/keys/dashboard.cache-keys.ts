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

/**
 * 动态数据「实时块」缓存键：只按门店聚合（与周期无关），缓存键不带 period。
 * 与状态块分开，避免分钟级不变的数据被 45s 一起重算。
 *
 * 必须带上业务日（上海零点时间戳）：动态内容里的「今日新增会员 / 今日充值 /
 * 今日订单」都是按天切窗口的，若键里没有日期，跨零点后的 TTL 窗口内会继续
 * 返回前一天的数据，后台刷新也会沿用旧时间窗口。
 */
export function buildProfitDashboardHomeActivitiesLiveCacheKey(
  storeId: number,
  businessDayStart: number,
): string {
  return `profit:dashboard:home-chunk:activities-live:store:${storeId}:day:${businessDayStart}`;
}

/** 动态数据「状态块」缓存键：只按门店聚合（与周期无关），理由同实时块 */
export function buildProfitDashboardHomeActivitiesStableCacheKey(
  storeId: number,
  businessDayStart: number,
): string {
  return `profit:dashboard:home-chunk:activities-stable:store:${storeId}:day:${businessDayStart}`;
}

/** 动态块失效模式：键里带业务日，精确删除需要先知道日期，统一按前缀通刷 */
export function buildProfitDashboardHomeActivitiesLivePattern(
  storeId: number,
): string {
  return `profit:dashboard:home-chunk:activities-live:store:${storeId}:*`;
}

export function buildProfitDashboardHomeActivitiesStablePattern(
  storeId: number,
): string {
  return `profit:dashboard:home-chunk:activities-stable:store:${storeId}:*`;
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
