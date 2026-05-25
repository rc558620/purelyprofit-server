import type { PulseDashboardPeriodValue } from '../dashboard/dto/pulse-dashboard-query.dto';

export const DEV_EXPIRES_AT = new Date('2099-12-31T23:59:59.999Z');
export const DEV_REMAINING_DAYS = 36_500;
export const DEV_MODE_NAME = '开发者模式';

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
