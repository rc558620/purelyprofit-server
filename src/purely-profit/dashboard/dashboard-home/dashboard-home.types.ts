import { Prisma, type EmployeeLeaveType } from '@prisma/client';

export const DASHBOARD_HOME_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'year',
  'last_year',
] as const;

export const DASHBOARD_HOME_LEGACY_PERIOD_VALUES = [
  '今日',
  '本周',
  '本月',
  '今年',
  '去年',
] as const;

export type DashboardHomePeriodValue =
  (typeof DASHBOARD_HOME_PERIOD_VALUES)[number];

export type DashboardHomeLegacyPeriodValue =
  (typeof DASHBOARD_HOME_LEGACY_PERIOD_VALUES)[number];

const DASHBOARD_HOME_PERIOD_ALIAS_MAP: Record<
  DashboardHomeLegacyPeriodValue,
  DashboardHomePeriodValue
> = {
  今日: 'today',
  本周: 'week',
  本月: 'month',
  今年: 'year',
  去年: 'last_year',
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

export interface DashboardHomeQueryInput {
  storeId?: number;
  period?: DashboardHomePeriodValue;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface LoadDashboardHomeOverviewDataParams {
  storeId: number;
  currentRange: TimeRange;
  compareRange: TimeRange;
  now: number;
}

export const DASHBOARD_HOME_STORE_SELECT =
  Prisma.validator<Prisma.StoreSelect>()({
    name: true,
  });

export type DashboardHomeStoreRow = Prisma.StoreGetPayload<{
  select: typeof DASHBOARD_HOME_STORE_SELECT;
}>;

export const DASHBOARD_HOME_SALE_ORDER_SELECT =
  Prisma.validator<Prisma.SaleOrderSelect>()({
    totalRevenue: true,
    date: true,
  });

export type SaleOrderRow = Prisma.SaleOrderGetPayload<{
  select: typeof DASHBOARD_HOME_SALE_ORDER_SELECT;
}>;

export const DASHBOARD_HOME_COST_RECORD_SELECT =
  Prisma.validator<Prisma.CostRecordSelect>()({
    amount: true,
    date: true,
  });

export type CostRecordRow = Prisma.CostRecordGetPayload<{
  select: typeof DASHBOARD_HOME_COST_RECORD_SELECT;
}>;

export const DASHBOARD_HOME_PRODUCT_ALERT_SELECT =
  Prisma.validator<Prisma.ProductSelect>()({
    id: true,
    name: true,
    stock: true,
    alertThreshold: true,
    updatedAt: true,
  });

export type ProductAlertRow = Prisma.ProductGetPayload<{
  select: typeof DASHBOARD_HOME_PRODUCT_ALERT_SELECT;
}>;

export const DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT =
  Prisma.validator<Prisma.FinanceAccountRecordSelect>()({
    id: true,
    counterpart: true,
    remaining: true,
    dueDate: true,
    updatedAt: true,
  });

export type OverdueAccountRow = Prisma.FinanceAccountRecordGetPayload<{
  select: typeof DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT;
}>;

export const DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT =
  Prisma.validator<Prisma.MarketingPromotionSelect>()({
    id: true,
    name: true,
    endAt: true,
    updatedAt: true,
  });

export type ActivePromotionRow = Prisma.MarketingPromotionGetPayload<{
  select: typeof DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT;
}>;

export const DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT =
  Prisma.validator<Prisma.PartnerWithdrawalSelect>()({
    id: true,
    beanAmount: true,
    appliedAt: true,
  });

export type PendingWithdrawalRow = Prisma.PartnerWithdrawalGetPayload<{
  select: typeof DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT;
}>;

export const DASHBOARD_HOME_UPCOMING_LEAVE_SELECT =
  Prisma.validator<Prisma.EmployeeLeaveSelect>()({
    id: true,
    employeeName: true,
    type: true,
    startDate: true,
    days: true,
    createdAt: true,
  });

export type UpcomingLeaveRow = Prisma.EmployeeLeaveGetPayload<{
  select: typeof DASHBOARD_HOME_UPCOMING_LEAVE_SELECT;
}>;

export interface AggregatedSalesResult {
  revenue: number;
  orderCount: number;
}

export interface AggregatedCostsResult {
  totalCost: number;
}

export interface DashboardHomeOverviewData {
  store: DashboardHomeStoreRow | null;
  saleTrendRows: SaleOrderRow[];
  currentSales: AggregatedSalesResult;
  compareSales: AggregatedSalesResult;
  currentCosts: AggregatedCostsResult;
  compareCosts: AggregatedCostsResult;
  lowStockProducts: ProductAlertRow[];
  overdueAccounts: OverdueAccountRow[];
  activePromotions: ActivePromotionRow[];
  pendingWithdrawals: PendingWithdrawalRow[];
  upcomingLeaves: UpcomingLeaveRow[];
}

export interface BuildDashboardHomeOverviewResponseParams {
  period: DashboardHomePeriodValue;
  storeId: number;
  currentRange: TimeRange;
  compareRange: TimeRange;
  now: number;
  overviewData: DashboardHomeOverviewData;
}

export interface ActivityDraft {
  id: string;
  type: DashboardHomeActivityTypeValue;
  icon: DashboardHomeActivityIconValue;
  title: string;
  time: string;
  value?: string;
  tag?: string;
  bizType?: string;
  bizId?: string;
  actionUrl?: string;
  createdAt: number;
}

export interface BuildDashboardHomeActivitiesParams {
  period: DashboardHomePeriodValue;
  currentSales: AggregatedSalesResult;
  compareSales: AggregatedSalesResult;
  lowStockProducts: ProductAlertRow[];
  overdueAccounts: OverdueAccountRow[];
  activePromotions: ActivePromotionRow[];
  pendingWithdrawals: PendingWithdrawalRow[];
  upcomingLeave?: UpcomingLeaveRow;
}

export type DashboardHomeLeaveType = EmployeeLeaveType;
