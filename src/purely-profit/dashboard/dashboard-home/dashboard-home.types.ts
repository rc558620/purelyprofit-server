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
  'member',
  'space',
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

export interface LoadDashboardHomeStatsDataParams {
  storeId: number;
  currentRange: TimeRange;
  compareRange: TimeRange;
}

export interface LoadDashboardHomeTrendDataParams {
  storeId: number;
  period: DashboardHomePeriodValue;
  currentRange: TimeRange;
}

export interface LoadDashboardHomeActivitiesDataParams {
  storeId: number;
  now: number;
}

export const DASHBOARD_HOME_STORE_SELECT =
  Prisma.validator<Prisma.StoreSelect>()({
    name: true,
  });

export type DashboardHomeStoreRow = Prisma.StoreGetPayload<{
  select: typeof DASHBOARD_HOME_STORE_SELECT;
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

export interface DashboardHomeTrendRevenueRow {
  bucketAt: Date;
  revenue: Prisma.Decimal | null;
}

export interface SaleOrderRow {
  date: Date;
  totalRevenue: Prisma.Decimal;
}

export interface CostRecordRow {
  date: Date;
  amount: Prisma.Decimal;
}

export interface AggregatedSalesResult {
  revenue: number;
  orderCount: number;
}

export interface AggregatedCostsResult {
  totalCost: number;
}

export interface DashboardHomeStatsData {
  store: DashboardHomeStoreRow | null;
  currentSales: AggregatedSalesResult;
  compareSales: AggregatedSalesResult;
  currentCosts: AggregatedCostsResult;
  compareCosts: AggregatedCostsResult;
}

export const DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT =
  Prisma.validator<Prisma.FinanceAccountRecordSelect>()({
    id: true,
    counterpart: true,
    remaining: true,
    dueDate: true,
    updatedAt: true,
  });

export type UpcomingAccountRow = Prisma.FinanceAccountRecordGetPayload<{
  select: typeof DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT;
}>;

export const DASHBOARD_HOME_TODAY_NEW_MEMBER_COUNT_SELECT =
  Prisma.validator<Prisma.MemberSelect>()({
    _count: true,
  });

export const DASHBOARD_HOME_TODAY_RECHARGE_SELECT =
  Prisma.validator<Prisma.MemberRechargeLogSelect>()({
    id: true,
    amount: true,
    createdAt: true,
  });

export type TodayRechargeRow = Prisma.MemberRechargeLogGetPayload<{
  select: typeof DASHBOARD_HOME_TODAY_RECHARGE_SELECT;
}>;

export const DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT =
  Prisma.validator<Prisma.SpaceReservationSelect>()({
    id: true,
    spaceId: true,
    guestName: true,
    reservedAt: true,
    createdAt: true,
  });

export type UpcomingReservationRow = Prisma.SpaceReservationGetPayload<{
  select: typeof DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT;
}>;

export const DASHBOARD_HOME_DRAFT_PAYROLL_SELECT =
  Prisma.validator<Prisma.EmployeePayrollSelect>()({
    id: true,
    employeeName: true,
    month: true,
    actualSalary: true,
    updatedAt: true,
  });

export type DraftPayrollRow = Prisma.EmployeePayrollGetPayload<{
  select: typeof DASHBOARD_HOME_DRAFT_PAYROLL_SELECT;
}>;

export const DASHBOARD_HOME_INACTIVE_VIP_SELECT =
  Prisma.validator<Prisma.MemberSelect>()({
    id: true,
    name: true,
    level: true,
    lastConsumeAt: true,
    updatedAt: true,
  });

export type InactiveVipRow = Prisma.MemberGetPayload<{
  select: typeof DASHBOARD_HOME_INACTIVE_VIP_SELECT;
}>;

export interface DailyRevenueRow {
  bucketAt: Date;
  revenue: Prisma.Decimal;
}

export const DASHBOARD_HOME_RECENT_ORDER_SELECT =
  Prisma.validator<Prisma.SaleOrderSelect>()({
    id: true,
    totalRevenue: true,
    date: true,
  createdAt: true,
  });

export type RecentOrderRow = Prisma.SaleOrderGetPayload<{
  select: typeof DASHBOARD_HOME_RECENT_ORDER_SELECT;
}>;

export interface DashboardHomeActivitiesData {
  lowStockProducts: ProductAlertRow[];
  overdueAccounts: OverdueAccountRow[];
  activePromotions: ActivePromotionRow[];
  pendingWithdrawals: PendingWithdrawalRow[];
  upcomingLeaves: UpcomingLeaveRow[];
  todayNewMemberCount: number;
  todayRecharges: TodayRechargeRow[];
  upcomingReservations: UpcomingReservationRow[];
  upcomingAccounts: UpcomingAccountRow[];
  draftPayrolls: DraftPayrollRow[];
  inactiveVips: InactiveVipRow[];
  dailyRevenueRows: DailyRevenueRow[];
  recentOrders: RecentOrderRow[];
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
  todayNewMemberCount: number;
  todayRecharges: TodayRechargeRow[];
  upcomingReservations: UpcomingReservationRow[];
  upcomingAccounts: UpcomingAccountRow[];
  draftPayrolls: DraftPayrollRow[];
  inactiveVips: InactiveVipRow[];
  dailyRevenueRows: DailyRevenueRow[];
  recentOrders: RecentOrderRow[];
}

export type DashboardHomeLeaveType = EmployeeLeaveType;
