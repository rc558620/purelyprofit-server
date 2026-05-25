import type { BusinessAnalysisPeriod } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-query.dto';
import type {
  PulseDashboardPeriodValue,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';

export const DASHBOARD_PERIOD_TODAY = 'today';
export const DASHBOARD_PERIOD_WEEK = 'week';
export const DASHBOARD_PERIOD_MONTH = 'month';
export const DASHBOARD_PERIOD_YEAR = 'year';
export const HOME_REVENUE_PERIOD_SEASON = 'season';

export const PERIOD_ORDER_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日订单数',
  week: '本周订单数',
  month: '本月订单数',
  year: '今年订单数',
};

export const PERIOD_PROFIT_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日净利润 (元)',
  week: '本周净利润 (元)',
  month: '本月净利润 (元)',
  year: '今年净利润 (元)',
};

export const DEFAULT_DASHBOARD_OVERVIEW_PERIOD: PulseDashboardPeriodValue =
  DASHBOARD_PERIOD_TODAY;
export const DEFAULT_DASHBOARD_STORES_PERIOD: PulseDashboardPeriodValue =
  DASHBOARD_PERIOD_MONTH;
export const DEFAULT_DASHBOARD_ANALYSIS_PERIOD: BusinessAnalysisPeriod =
  DASHBOARD_PERIOD_MONTH;

export const DEFAULT_HOME_REVENUE_PERIOD: PulseHomeRevenuePeriodValue =
  DASHBOARD_PERIOD_MONTH;
export const DEFAULT_REVENUE_DETAIL_PERIOD: PulseHomeRevenuePeriodValue =
  DASHBOARD_PERIOD_MONTH;
export const REVENUE_DETAIL_SINGLE_DAY_PERIOD: PulseHomeRevenuePeriodValue =
  DASHBOARD_PERIOD_TODAY;
export const REVENUE_DETAIL_RANGE_PERIOD: PulseHomeRevenuePeriodValue =
  DASHBOARD_PERIOD_MONTH;

export const UNKNOWN_REGION_LABEL = '未知';
export const EMPTY_REGION_PLACEHOLDER = '--';

export const ONLINE_COUNT_RATIO = 0.08;
export const ONLINE_PEAK_RATIO = 0.15;
export const ONLINE_CHANGE_RATIO = 12.0;

export const REVENUE_MONTHLY_LABEL = '月卡会员';
export const REVENUE_QUARTERLY_LABEL = '季度会员';
export const REVENUE_YEARLY_LABEL = '年卡会员';
export const REVENUE_FALLBACK_LABEL = '其他充值';

export const REVENUE_TYPE_LABELS = [
  REVENUE_MONTHLY_LABEL,
  REVENUE_QUARTERLY_LABEL,
  REVENUE_YEARLY_LABEL,
  REVENUE_FALLBACK_LABEL,
] as const;

export const DASHBOARD_TREND_TODAY_BUCKET_HOURS = [
  8, 10, 12, 14, 16, 18, 20, 22,
] as const;
export const DASHBOARD_TREND_TODAY_BUCKET_LABELS =
  DASHBOARD_TREND_TODAY_BUCKET_HOURS.map(
    (hour) => `${String(hour).padStart(2, '0')}:00`,
  );
export const DASHBOARD_TREND_YEAR_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);
