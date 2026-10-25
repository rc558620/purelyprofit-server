import { toCacheSegment } from '../redis/cache-keys.shared';

type PulseRevenueDetailCacheQuery = {
  period?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  regionValues?: string;
  regionCode?: string;
  provinceCode?: string;
  cityCode?: string;
  districtCode?: string;
};

type PulseSessionBootstrapCacheQuery = {
  userId: number;
  mode: string;
  targetStoreId: number | null;
};

type PulseOnboardingStatusCacheQuery = {
  userId: number;
  mode: string;
  targetStoreId: number | null;
};

export type PulseGrowthAdminListCacheQuery = {
  mode: string;
  scope: string;
  tab?: string;
  cursor?: string;
  limit?: number;
};

export function buildPulseSessionNotificationCacheKey(storeId: number): string {
  return `pulse:session:notifications:store:${storeId}`;
}

export function buildPulseSessionBootstrapCacheKey(
  userId: number,
  mode: string,
  targetStoreId: number | null,
): string {
  return buildPulseSessionBootstrapCacheKeyFromQuery({
    userId,
    mode,
    targetStoreId,
  });
}

export function buildPulseSessionBootstrapCacheKeyFromQuery(
  query: PulseSessionBootstrapCacheQuery,
): string {
  return [
    'pulse:session:bootstrap',
    `user:${query.userId}`,
    `mode:${toCacheSegment(query.mode)}`,
    `store:${toCacheSegment(query.targetStoreId ?? 'none')}`,
  ].join(':');
}

export function buildPulseSessionBootstrapPatternByStore(
  _storeId: number,
): string {
  void _storeId; // 预留参数，后续可按门店精确清理缓存
  return 'pulse:session:bootstrap:user:*:mode:*:store:*';
}

export function buildPulseSessionBootstrapPatternByUser(
  userId: number,
): string {
  return `pulse:session:bootstrap:user:${userId}:mode:*:store:*`;
}

export function buildPulseOnboardingStatusCacheKey(
  userId: number,
  mode: string,
  targetStoreId: number | null,
): string {
  return buildPulseOnboardingStatusCacheKeyFromQuery({
    userId,
    mode,
    targetStoreId,
  });
}

export function buildPulseOnboardingStatusCacheKeyFromQuery(
  query: PulseOnboardingStatusCacheQuery,
): string {
  return [
    'pulse:onboarding:status',
    `user:${query.userId}`,
    `mode:${toCacheSegment(query.mode)}`,
    `store:${toCacheSegment(query.targetStoreId ?? 'none')}`,
  ].join(':');
}

export function buildPulseOnboardingStatusPatternByStore(
  _storeId: number,
): string {
  void _storeId; // 预留参数，后续可按门店精确清理缓存
  return 'pulse:onboarding:status:user:*:mode:*:store:*';
}

export function buildPulseOnboardingStatusPatternByUser(
  userId: number,
): string {
  return `pulse:onboarding:status:user:${userId}:mode:*:store:*`;
}

/**
 * Home 页自定义收入区间。
 *
 * 自定义单日 / 区间必须进入缓存键：否则首次按自定义日期查询的结果
 * 会被同周期、同地区的默认查询命中复用，表现为筛选「时灵时不灵」。
 */
export interface PulseDashboardHomeCacheDateRange {
  customDate?: string | undefined;
  customRangeStart?: string | undefined;
  customRangeEnd?: string | undefined;
}

export function buildPulseDashboardHomeCacheKey(
  revenuePeriod: string,
  region: string | undefined,
  regionCode: string | undefined = undefined,
  dateRange: PulseDashboardHomeCacheDateRange = {},
): string {
  const regionSegment = encodeURIComponent(region ?? 'all');
  const regionCodeSegment = encodeURIComponent(regionCode ?? 'all');
  return [
    `pulse:dashboard:home:period:${revenuePeriod}`,
    `region:${regionSegment}`,
    `regionCode:${regionCodeSegment}`,
    `day:${toCacheSegment(dateRange.customDate)}`,
    `start:${toCacheSegment(dateRange.customRangeStart)}`,
    `end:${toCacheSegment(dateRange.customRangeEnd)}`,
  ].join(':');
}

export function buildPulseDashboardHomePattern(): string {
  return 'pulse:dashboard:home:period:*:region:*';
}

export function buildPulseDashboardRevenueDetailCacheKey(
  query: PulseRevenueDetailCacheQuery,
): string {
  return [
    'pulse:dashboard:revenue-detail',
    `period:${toCacheSegment(query.period)}`,
    `date:${toCacheSegment(query.date)}`,
    `start:${toCacheSegment(query.startDate)}`,
    `end:${toCacheSegment(query.endDate)}`,
    `regionValues:${toCacheSegment(query.regionValues)}`,
    `regionCode:${toCacheSegment(query.regionCode)}`,
    `provinceCode:${toCacheSegment(query.provinceCode)}`,
    `cityCode:${toCacheSegment(query.cityCode)}`,
    `districtCode:${toCacheSegment(query.districtCode)}`,
  ].join(':');
}

export function buildPulseDashboardRevenueDetailPattern(): string {
  return 'pulse:dashboard:revenue-detail:*';
}

export function buildPulseDashboardOverviewCacheKey(
  storeId: number,
  period: string,
): string {
  return `pulse:dashboard:overview:store:${storeId}:period:${period}`;
}

export function buildPulseDashboardOverviewPattern(storeId: number): string {
  return `pulse:dashboard:overview:store:${storeId}:period:*`;
}

export function buildPulseDashboardStoresCacheKey(
  storeId: number,
  period: string,
): string {
  return `pulse:dashboard:stores:store:${storeId}:period:${period}`;
}

export function buildPulseDashboardStoresPattern(storeId: number): string {
  return `pulse:dashboard:stores:store:${storeId}:period:*`;
}

export function buildPulseGrowthEarningsOverviewCacheKey(
  storeId: number,
): string {
  return `pulse:growth:earnings:overview:store:${storeId}`;
}

export function buildPulseGrowthEarningsLogsCacheKey(
  storeId: number,
  typeFilter: string,
): string {
  return `pulse:growth:earnings:logs:store:${storeId}:type:${typeFilter}`;
}

export function buildPulseGrowthEarningsPatterns(
  storeId: number,
): readonly [string, string] {
  return [
    `pulse:growth:earnings:*:store:${storeId}`,
    `pulse:growth:earnings:*:store:${storeId}:*`,
  ] as const;
}

export function buildPulseGrowthEarningsPattern(storeId: number): string {
  return `pulse:growth:earnings:*:store:${storeId}:*`;
}

export function buildPulseGrowthAdminPartnerApplicationsCacheKey(
  query: PulseGrowthAdminListCacheQuery,
): string {
  return [
    'pulse:growth:admin:partner-applications',
    `mode:${toCacheSegment(query.mode)}`,
    `scope:${toCacheSegment(query.scope)}`,
    `tab:${toCacheSegment(query.tab ?? 'all')}`,
    `cursor:${toCacheSegment(query.cursor)}`,
    `limit:${toCacheSegment(query.limit)}`,
  ].join(':');
}

export function buildPulseGrowthAdminPayoutsCacheKey(
  query: PulseGrowthAdminListCacheQuery,
): string {
  return [
    'pulse:growth:admin:payouts',
    `mode:${toCacheSegment(query.mode)}`,
    `scope:${toCacheSegment(query.scope)}`,
    `tab:${toCacheSegment(query.tab ?? 'all')}`,
    `cursor:${toCacheSegment(query.cursor)}`,
    `limit:${toCacheSegment(query.limit)}`,
  ].join(':');
}

export function buildPulseGrowthAdminPattern(): string {
  return 'pulse:growth:admin:*';
}
