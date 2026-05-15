export const DASHBOARD_HOME_PERIOD_VALUES = [
  '今日',
  '本周',
  '本月',
  '今年',
  '去年',
] as const;

export const DASHBOARD_HOME_LEGACY_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'year',
  'last_year',
] as const;

export type DashboardHomePeriodValue =
  (typeof DASHBOARD_HOME_PERIOD_VALUES)[number];

export type DashboardHomeLegacyPeriodValue =
  (typeof DASHBOARD_HOME_LEGACY_PERIOD_VALUES)[number];

const DASHBOARD_HOME_PERIOD_ALIAS_MAP: Record<
  DashboardHomeLegacyPeriodValue,
  DashboardHomePeriodValue
> = {
  today: '今日',
  week: '本周',
  month: '本月',
  year: '今年',
  last_year: '去年',
};

export function normalizeDashboardHomePeriod(
  value: unknown,
): DashboardHomePeriodValue | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  if (
    (DASHBOARD_HOME_PERIOD_VALUES as readonly string[]).includes(trimmedValue)
  ) {
    return trimmedValue as DashboardHomePeriodValue;
  }

  if (
    (DASHBOARD_HOME_LEGACY_PERIOD_VALUES as readonly string[]).includes(
      trimmedValue,
    )
  ) {
    return DASHBOARD_HOME_PERIOD_ALIAS_MAP[
      trimmedValue as DashboardHomeLegacyPeriodValue
    ];
  }

  return undefined;
}

export const DASHBOARD_HOME_ACTIVITY_TYPE_VALUES = [
  'success',
  'warning',
  'info',
] as const;

export type DashboardHomeActivityTypeValue =
  (typeof DASHBOARD_HOME_ACTIVITY_TYPE_VALUES)[number];

export const DASHBOARD_HOME_ACTIVITY_ICON_VALUES = [
  'sales',
  'inventory',
  'finance',
  'marketing',
  'withdrawal',
  'employee',
] as const;

export type DashboardHomeActivityIconValue =
  (typeof DASHBOARD_HOME_ACTIVITY_ICON_VALUES)[number];
