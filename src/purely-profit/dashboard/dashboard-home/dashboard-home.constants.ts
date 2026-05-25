import { EmployeeLeaveType } from '@prisma/client';
import type { DashboardHomePeriodValue } from './dashboard-home.types';

export const DAY_MS = 86_400_000;
export const TODAY_BUCKET_LABELS = [
  '08:00',
  '10:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '22:00',
] as const;
export const YEAR_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);
export const MAX_HOME_ACTIVITY_COUNT = 8;

export interface DashboardHomePeriodMeta {
  displayLabel: string;
  profitLabel: string;
  orderLabel: string;
  compareLabel: string;
  compareTarget: string;
}

export const PERIOD_META: Record<
  DashboardHomePeriodValue,
  DashboardHomePeriodMeta
> = {
  today: {
    displayLabel: '今日',
    profitLabel: '今日净利润 (元)',
    orderLabel: '今日订单数',
    compareLabel: '较昨日',
    compareTarget: '昨日',
  },
  week: {
    displayLabel: '本周',
    profitLabel: '本周净利润 (元)',
    orderLabel: '本周订单数',
    compareLabel: '较上周',
    compareTarget: '上周',
  },
  month: {
    displayLabel: '本月',
    profitLabel: '本月净利润 (元)',
    orderLabel: '本月订单数',
    compareLabel: '较上月',
    compareTarget: '上月',
  },
  year: {
    displayLabel: '今年',
    profitLabel: '今年净利润 (元)',
    orderLabel: '今年订单数',
    compareLabel: '较去年',
    compareTarget: '去年',
  },
  last_year: {
    displayLabel: '去年',
    profitLabel: '去年净利润 (元)',
    orderLabel: '去年订单数',
    compareLabel: '较前年',
    compareTarget: '前年',
  },
};

export const LEAVE_TYPE_LABELS: Record<EmployeeLeaveType, string> = {
  personal: '事假',
  sick: '病假',
  annual: '年假',
  marriage: '婚假',
  other: '请假',
};
