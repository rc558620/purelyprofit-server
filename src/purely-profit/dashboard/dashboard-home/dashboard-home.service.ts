import { Injectable } from '@nestjs/common';
import { EmployeeLeaveType, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toDecimalNumber } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type {
  DashboardHomeActivityDto,
  DashboardHomeMetaDto,
  DashboardHomeOverviewResponseDto,
  DashboardHomeSalesTrendDto,
  DashboardHomeStatsDto,
} from './dto/dashboard-home-response.dto';
import type {
  DashboardHomeActivityIconValue,
  DashboardHomeActivityTypeValue,
  DashboardHomePeriodValue,
} from './dashboard-home.types';

const DAY_MS = 86_400_000;
const TODAY_BUCKET_LABELS = [
  '08:00',
  '10:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '22:00',
] as const;
const YEAR_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);
const MAX_HOME_ACTIVITY_COUNT = 8;

const PERIOD_META: Record<
  DashboardHomePeriodValue,
  {
    displayLabel: string;
    profitLabel: string;
    orderLabel: string;
    compareLabel: string;
    compareTarget: string;
  }
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

const LEAVE_TYPE_LABELS: Record<EmployeeLeaveType, string> = {
  personal: '事假',
  sick: '病假',
  annual: '年假',
  marriage: '婚假',
  other: '请假',
};

interface DashboardHomeQueryInput {
  storeId?: number;
  period?: DashboardHomePeriodValue;
}

interface TimeRange {
  start: number;
  end: number;
}

interface SaleOrderRow {
  totalRevenue: Prisma.Decimal;
  date: Date;
}

interface CostRecordRow {
  amount: Prisma.Decimal;
  date: Date;
}

interface ProductAlertRow {
  id: number;
  name: string;
  stock: number;
  alertThreshold: number;
  updatedAt: Date;
}

interface OverdueAccountRow {
  id: number;
  counterpart: string;
  remaining: Prisma.Decimal;
  dueDate: Date | null;
  updatedAt: Date;
}

interface ActivePromotionRow {
  id: number;
  name: string;
  endAt: Date;
  updatedAt: Date;
}

interface PendingWithdrawalRow {
  id: number;
  beanAmount: number;
  appliedAt: Date;
}

interface UpcomingLeaveRow {
  id: number;
  employeeName: string;
  type: EmployeeLeaveType;
  startDate: Date;
  days: Prisma.Decimal;
  createdAt: Date;
}

interface AggregatedSalesResult {
  revenue: number;
  orderCount: number;
}

interface AggregatedCostsResult {
  totalCost: number;
}

interface ActivityDraft {
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

@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query: DashboardHomeQueryInput = {
      storeId: queryDto.storeId,
      period: queryDto.period,
    };
    const period = query.period ?? 'today';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店首页概览',
    );

    const currentRange = this.buildCurrentRange(period);
    const compareRange = this.buildCompareRange(period, currentRange);
    const queryStart = Math.min(currentRange.start, compareRange.start);
    const now = Date.now();
    const todayStart = this.getDayStart(now);
    const upcomingLeaveEnd = this.getDayEnd(todayStart + DAY_MS * 3);
    const storePromise = this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const saleOrdersPromise = this.prisma.saleOrder.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(queryStart),
          lte: new Date(currentRange.end),
        },
      },
      select: {
        totalRevenue: true,
        date: true,
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const costRecordsPromise = this.prisma.costRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(queryStart),
          lte: new Date(currentRange.end),
        },
      },
      select: {
        amount: true,
        date: true,
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const lowStockProductsPromise = this.prisma.product.findMany({
      where: {
        storeId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        stock: true,
        alertThreshold: true,
        updatedAt: true,
      },
      orderBy: [{ stock: 'asc' }, { updatedAt: 'desc' }],
      take: 12,
    });
    const overdueAccountsPromise = this.prisma.financeAccountRecord.findMany({
      where: {
        storeId,
        status: 'overdue',
      },
      select: {
        id: true,
        counterpart: true,
        remaining: true,
        dueDate: true,
        updatedAt: true,
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    });
    const activePromotionsPromise = this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        startAt: {
          lte: new Date(now),
        },
        endAt: {
          gte: new Date(now),
        },
      },
      select: {
        id: true,
        name: true,
        endAt: true,
        updatedAt: true,
      },
      orderBy: [{ endAt: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    });
    const pendingWithdrawalsPromise = this.prisma.partnerWithdrawal.findMany({
      where: {
        storeId,
        status: 'pending',
      },
      select: {
        id: true,
        beanAmount: true,
        appliedAt: true,
      },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: 5,
    });
    const upcomingLeavesPromise = this.prisma.employeeLeave.findMany({
      where: {
        storeId,
        startDate: {
          gte: new Date(todayStart),
          lte: new Date(upcomingLeaveEnd),
        },
      },
      select: {
        id: true,
        employeeName: true,
        type: true,
        startDate: true,
        days: true,
        createdAt: true,
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
      take: 1,
    });

    const [
      store,
      saleOrders,
      costRecords,
      lowStockProducts,
      overdueAccounts,
      activePromotions,
      pendingWithdrawals,
      upcomingLeaves,
    ]: [
      { name: string } | null,
      SaleOrderRow[],
      CostRecordRow[],
      ProductAlertRow[],
      OverdueAccountRow[],
      ActivePromotionRow[],
      PendingWithdrawalRow[],
      UpcomingLeaveRow[],
    ] = await Promise.all([
      storePromise,
      saleOrdersPromise,
      costRecordsPromise,
      lowStockProductsPromise,
      overdueAccountsPromise,
      activePromotionsPromise,
      pendingWithdrawalsPromise,
      upcomingLeavesPromise,
    ]);

    const currentSales = this.aggregateSales(
      saleOrders,
      currentRange.start,
      currentRange.end,
    );
    const compareSales = this.aggregateSales(
      saleOrders,
      compareRange.start,
      compareRange.end,
    );
    const currentCosts = this.aggregateCosts(
      costRecords,
      currentRange.start,
      currentRange.end,
    );
    const compareCosts = this.aggregateCosts(
      costRecords,
      compareRange.start,
      compareRange.end,
    );

    const stats = this.buildStats(
      period,
      currentSales,
      compareSales,
      currentCosts,
      compareCosts,
    );
    const salesTrend = this.buildSalesTrend(
      period,
      currentRange,
      saleOrders,
    );
    const activities = this.buildActivities({
      period,
      currentSales,
      compareSales,
      lowStockProducts,
      overdueAccounts,
      activePromotions,
      pendingWithdrawals,
      upcomingLeave: upcomingLeaves[0],
    });
    const meta: DashboardHomeMetaDto = {
      period,
      storeId,
      storeName: store?.name ?? `门店 ${storeId}`,
      startAt: currentRange.start,
      endAt: currentRange.end,
      compareStartAt: compareRange.start,
      compareEndAt: compareRange.end,
      generatedAt: now,
    };

    return {
      stats,
      salesTrend,
      activities,
      meta,
    };
  }

  private buildStats(
    period: DashboardHomePeriodValue,
    currentSales: AggregatedSalesResult,
    compareSales: AggregatedSalesResult,
    currentCosts: AggregatedCostsResult,
    compareCosts: AggregatedCostsResult,
  ): DashboardHomeStatsDto {
    const meta = PERIOD_META[period];
    const currentProfit = this.subtractMoney(
      currentSales.revenue,
      currentCosts.totalCost,
    );
    const compareProfit = this.subtractMoney(
      compareSales.revenue,
      compareCosts.totalCost,
    );

    return {
      profitLabel: meta.profitLabel,
      profit: currentProfit,
      profitChange: this.calcChangeRate(currentProfit, compareProfit),
      profitCompareLabel: meta.compareLabel,
      orderLabel: meta.orderLabel,
      orderCount: currentSales.orderCount,
      orderChange: this.calcChangeRate(
        currentSales.orderCount,
        compareSales.orderCount,
      ),
      orderCompareLabel: meta.compareLabel,
    };
  }

  private buildSalesTrend(
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
    saleOrders: SaleOrderRow[],
  ): DashboardHomeSalesTrendDto {
    if (period === 'today') {
      return this.buildTodaySalesTrend(currentRange, saleOrders);
    }

    if (period === 'week') {
      return this.buildRecentDaySalesTrend(7, currentRange.end, saleOrders);
    }

    if (period === 'month') {
      return this.buildCurrentMonthSalesTrend(currentRange, saleOrders);
    }

    return this.buildYearSalesTrend(period, saleOrders);
  }

  private buildTodaySalesTrend(
    currentRange: TimeRange,
    saleOrders: SaleOrderRow[],
  ): DashboardHomeSalesTrendDto {
    const todayStart = this.getDayStart(currentRange.end);
    const actual: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);
    const forecast: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);

    for (const row of saleOrders) {
      const timestamp = row.date.getTime();
      if (timestamp < currentRange.start || timestamp > currentRange.end) {
        continue;
      }

      const bucketIndex = this.getTodayBucketIndex(timestamp);
      actual[bucketIndex] = this.addMoney(
        actual[bucketIndex] ?? 0,
        toDecimalNumber(row.totalRevenue),
      );
    }

    const now = currentRange.end;
    let firstFutureBucketIndex: number | null = null;
    const realizedValues: number[] = [];

    TODAY_BUCKET_LABELS.forEach((label, index) => {
      const bucketTime = this.buildTodayBucketTimestamp(todayStart, label);
      if (bucketTime <= now) {
        actual[index] ??= 0;
        realizedValues.push(actual[index] ?? 0);
        return;
      }

      if (firstFutureBucketIndex === null) {
        firstFutureBucketIndex = index;
      }
      actual[index] = null;
    });

    if (firstFutureBucketIndex !== null && realizedValues.length > 0) {
      const average = realizedValues.reduce((sum, value) => sum + value, 0)
        / realizedValues.length;
      if (average > 0) {
        forecast[firstFutureBucketIndex] = this.roundMoney(average);
      }
    }

    return {
      title: '销售趋势图',
      categories: [...TODAY_BUCKET_LABELS],
      actual,
      forecast,
      isYearMode: false,
      seriesNameActual: '实收',
      seriesNameForecast: '预测',
    };
  }

  private buildRecentDaySalesTrend(
    days: number,
    anchorTimestamp: number,
    saleOrders: SaleOrderRow[],
  ): DashboardHomeSalesTrendDto {
    const lastDayStart = this.getDayStart(anchorTimestamp);
    const firstDayStart = lastDayStart - DAY_MS * (days - 1);
    const revenueMap = this.buildDailyRevenueMap(
      saleOrders,
      firstDayStart,
      anchorTimestamp,
    );

    const categories: string[] = [];
    const actual: Array<number | null> = [];

    for (let index = 0; index < days; index += 1) {
      const currentDayStart = firstDayStart + DAY_MS * index;
      categories.push(this.formatMonthDay(currentDayStart));
      actual.push(revenueMap.get(currentDayStart) ?? 0);
    }

    return {
      title: '销售趋势图',
      categories,
      actual,
      forecast: Array.from({ length: actual.length }, () => null),
      isYearMode: false,
      seriesNameActual: '实收',
      seriesNameForecast: '预测',
    };
  }

  private buildCurrentMonthSalesTrend(
    currentRange: TimeRange,
    saleOrders: SaleOrderRow[],
  ): DashboardHomeSalesTrendDto {
    const revenueMap = this.buildDailyRevenueMap(
      saleOrders,
      currentRange.start,
      currentRange.end,
    );
    const categories: string[] = [];
    const actual: Array<number | null> = [];
    const lastDayStart = this.getDayStart(currentRange.end);

    for (
      let dayStart = currentRange.start;
      dayStart <= lastDayStart;
      dayStart += DAY_MS
    ) {
      categories.push(this.formatMonthDay(dayStart));
      actual.push(revenueMap.get(dayStart) ?? 0);
    }

    return {
      title: '销售趋势图',
      categories,
      actual,
      forecast: Array.from({ length: actual.length }, () => null),
      isYearMode: false,
      seriesNameActual: '实收',
      seriesNameForecast: '预测',
    };
  }

  private buildYearSalesTrend(
    period: DashboardHomePeriodValue,
    saleOrders: SaleOrderRow[],
  ): DashboardHomeSalesTrendDto {
    const year =
      period === 'last_year'
        ? new Date().getFullYear() - 1
        : new Date().getFullYear();
    const revenueMap = new Map<number, number>();

    for (const row of saleOrders) {
      const date = row.date;
      if (date.getFullYear() !== year) {
        continue;
      }

      const monthIndex = date.getMonth();
      revenueMap.set(
        monthIndex,
        this.addMoney(
          revenueMap.get(monthIndex) ?? 0,
          toDecimalNumber(row.totalRevenue),
        ),
      );
    }

    return {
      title: '销售趋势图',
      categories: [...YEAR_MONTH_LABELS],
      actual: YEAR_MONTH_LABELS.map(
        (_label, index) => revenueMap.get(index) ?? 0,
      ),
      forecast: YEAR_MONTH_LABELS.map(() => null),
      isYearMode: true,
      seriesNameActual: '实收',
      seriesNameForecast: '预测',
    };
  }

  private buildActivities(params: {
    period: DashboardHomePeriodValue;
    currentSales: AggregatedSalesResult;
    compareSales: AggregatedSalesResult;
    lowStockProducts: ProductAlertRow[];
    overdueAccounts: OverdueAccountRow[];
    activePromotions: ActivePromotionRow[];
    pendingWithdrawals: PendingWithdrawalRow[];
    upcomingLeave?: UpcomingLeaveRow;
  }): DashboardHomeActivityDto[] {
    const drafts: ActivityDraft[] = [];
    const periodMeta = PERIOD_META[params.period];
    const now = Date.now();
    const salesDiff = this.subtractMoney(
      params.currentSales.revenue,
      params.compareSales.revenue,
    );
    const salesChange = this.calcChangeRate(
      params.currentSales.revenue,
      params.compareSales.revenue,
    );

    if (salesDiff !== 0) {
      const isRise = salesDiff > 0;
      drafts.push({
        id: `sales-${params.period}`,
        type: isRise ? 'success' : 'info',
        icon: 'sales',
        title: `${periodMeta.displayLabel}销售额${isRise ? '超' : '低于'}${periodMeta.compareTarget}`,
        time:
          salesChange === null
            ? '刚刚 · 暂无对比数据'
            : `刚刚 · 环比 ${this.formatSignedPercent(salesChange)}`,
        value: `${salesDiff > 0 ? '+' : '-'}¥${this.formatMoneyText(
          Math.abs(salesDiff),
        )}`,
        bizType: 'sales',
        actionUrl: '/sales-record',
        createdAt: now,
      });
    }

    const lowStockItems = params.lowStockProducts
      .filter((item) => item.stock <= item.alertThreshold)
      .slice(0, 2);
    for (const item of lowStockItems) {
      drafts.push({
        id: `inventory-${item.id}`,
        type: 'warning',
        icon: 'inventory',
        title: `${item.name} 库存预警`,
        time: `${this.formatRelativeTime(item.updatedAt.getTime(), now)} · 系统`,
        tag: `剩${item.stock}件`,
        bizType: 'inventory',
        bizId: String(item.id),
        actionUrl: '/stocktaking',
        createdAt: item.updatedAt.getTime(),
      });
    }

    if (params.overdueAccounts.length > 0) {
      const totalRemaining = params.overdueAccounts.reduce(
        (sum, item) =>
          this.addMoney(sum, toDecimalNumber(item.remaining)),
        0,
      );
      const latestOverdue = params.overdueAccounts[0];
      drafts.push({
        id: 'finance-overdue',
        type: 'warning',
        icon: 'finance',
        title: `有${params.overdueAccounts.length}笔账款已逾期`,
        time: `${this.formatRelativeTime(latestOverdue.updatedAt.getTime(), now)} · 财务管理`,
        tag: `¥${this.formatMoneyText(totalRemaining)}`,
        bizType: 'finance_account',
        bizId: String(latestOverdue.id),
        actionUrl: '/accounts-management',
        createdAt: latestOverdue.updatedAt.getTime(),
      });
    }

    if (params.activePromotions.length > 0) {
      const latestPromotion = params.activePromotions[0];
      drafts.push({
        id: 'marketing-active',
        type: 'info',
        icon: 'marketing',
        title: `当前有${params.activePromotions.length}个营销活动进行中`,
        time: `${this.formatRelativeTime(latestPromotion.updatedAt.getTime(), now)} · 营销中心`,
        tag: `至${this.formatMonthDay(latestPromotion.endAt.getTime())}`,
        bizType: 'marketing_promotion',
        bizId: String(latestPromotion.id),
        actionUrl: '/marketing-center',
        createdAt: latestPromotion.updatedAt.getTime(),
      });
    }

    if (params.pendingWithdrawals.length > 0) {
      const latestWithdrawal = params.pendingWithdrawals[0];
      const totalBeans = params.pendingWithdrawals.reduce(
        (sum, item) => sum + item.beanAmount,
        0,
      );
      drafts.push({
        id: 'withdrawal-pending',
        type: 'info',
        icon: 'withdrawal',
        title: `有${params.pendingWithdrawals.length}笔提现待处理`,
        time: `${this.formatRelativeTime(latestWithdrawal.appliedAt.getTime(), now)} · 会员中心`,
        tag: `待审${totalBeans}豆`,
        bizType: 'withdrawal',
        bizId: String(latestWithdrawal.id),
        actionUrl: '/member-center',
        createdAt: latestWithdrawal.appliedAt.getTime(),
      });
    }

    if (params.upcomingLeave) {
      const leave = params.upcomingLeave;
      drafts.push({
        id: `employee-leave-${leave.id}`,
        type: 'info',
        icon: 'employee',
        title: `${leave.employeeName}${LEAVE_TYPE_LABELS[leave.type]}即将开始`,
        time: `${this.formatRelativeTime(leave.createdAt.getTime(), now)} · 员工管理`,
        tag: `${this.formatMoneyText(toDecimalNumber(leave.days))}天`,
        bizType: 'employee_leave',
        bizId: String(leave.id),
        actionUrl: '/employee-management',
        createdAt: leave.createdAt.getTime(),
      });
    }

    return drafts
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_HOME_ACTIVITY_COUNT);
  }

  private aggregateSales(
    saleOrders: SaleOrderRow[],
    start: number,
    end: number,
  ): AggregatedSalesResult {
    let revenue = 0;
    let orderCount = 0;

    for (const row of saleOrders) {
      const timestamp = row.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      revenue = this.addMoney(revenue, toDecimalNumber(row.totalRevenue));
      orderCount += 1;
    }

    return {
      revenue,
      orderCount,
    };
  }

  private aggregateCosts(
    costRecords: CostRecordRow[],
    start: number,
    end: number,
  ): AggregatedCostsResult {
    let totalCost = 0;

    for (const row of costRecords) {
      const timestamp = row.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      totalCost = this.addMoney(totalCost, toDecimalNumber(row.amount));
    }

    return { totalCost };
  }

  private buildDailyRevenueMap(
    saleOrders: SaleOrderRow[],
    start: number,
    end: number,
  ): Map<number, number> {
    const revenueMap = new Map<number, number>();

    for (const row of saleOrders) {
      const timestamp = row.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      const dayStart = this.getDayStart(timestamp);
      revenueMap.set(
        dayStart,
        this.addMoney(
          revenueMap.get(dayStart) ?? 0,
          toDecimalNumber(row.totalRevenue),
        ),
      );
    }

    return revenueMap;
  }

  private buildCurrentRange(period: DashboardHomePeriodValue): TimeRange {
    const now = Date.now();
    const currentDate = new Date(now);

    switch (period) {
      case 'today':
        return {
          start: this.getDayStart(now),
          end: now,
        };
      case 'week': {
        const start = new Date(currentDate);
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        return {
          start: start.getTime(),
          end: now,
        };
      }
      case 'month':
        return {
          start: new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            1,
          ).getTime(),
          end: now,
        };
      case 'year':
        return {
          start: new Date(currentDate.getFullYear(), 0, 1).getTime(),
          end: now,
        };
      case 'last_year': {
        const year = currentDate.getFullYear() - 1;
        return {
          start: new Date(year, 0, 1).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        };
      }
    }
  }

  private buildCompareRange(
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
  ): TimeRange {
    const currentDuration = currentRange.end - currentRange.start;

    switch (period) {
      case 'today': {
        const start = currentRange.start - DAY_MS;
        return {
          start,
          end: start + currentDuration,
        };
      }
      case 'week': {
        const start = currentRange.start - DAY_MS * 7;
        return {
          start,
          end: start + currentDuration,
        };
      }
      case 'month': {
        const currentStartDate = new Date(currentRange.start);
        const previousMonthStart = new Date(
          currentStartDate.getFullYear(),
          currentStartDate.getMonth() - 1,
          1,
        );
        const previousMonthEnd = new Date(
          currentStartDate.getFullYear(),
          currentStartDate.getMonth(),
          0,
          23,
          59,
          59,
          999,
        );
        return {
          start: previousMonthStart.getTime(),
          end: Math.min(
            previousMonthStart.getTime() + currentDuration,
            previousMonthEnd.getTime(),
          ),
        };
      }
      case 'year': {
        const currentStartDate = new Date(currentRange.start);
        const previousYearStart = new Date(
          currentStartDate.getFullYear() - 1,
          0,
          1,
        );
        const previousYearEnd = new Date(
          currentStartDate.getFullYear() - 1,
          11,
          31,
          23,
          59,
          59,
          999,
        );
        return {
          start: previousYearStart.getTime(),
          end: Math.min(
            previousYearStart.getTime() + currentDuration,
            previousYearEnd.getTime(),
          ),
        };
      }
      case 'last_year': {
        const currentYear = new Date(currentRange.start).getFullYear();
        const compareYear = currentYear - 1;
        return {
          start: new Date(compareYear, 0, 1).getTime(),
          end: new Date(compareYear, 11, 31, 23, 59, 59, 999).getTime(),
        };
      }
    }
  }

  private getTodayBucketIndex(timestamp: number): number {
    const date = new Date(timestamp);
    const hour = date.getHours();
    if (hour < 10) return 0;
    if (hour < 12) return 1;
    if (hour < 14) return 2;
    if (hour < 16) return 3;
    if (hour < 18) return 4;
    if (hour < 20) return 5;
    if (hour < 22) return 6;
    return 7;
  }

  private buildTodayBucketTimestamp(dayStart: number, label: string): number {
    const [hourText, minuteText] = label.split(':');
    const hour = Number.parseInt(hourText ?? '0', 10);
    const minute = Number.parseInt(minuteText ?? '0', 10);
    return dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  }

  private getDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private getDayEnd(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  private formatMonthDay(timestamp: number): string {
    const date = new Date(timestamp);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  }

  private addMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).plus(right).toNumber());
  }

  private subtractMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).minus(right).toNumber());
  }

  private calcChangeRate(current: number, previous: number): number | null {
    if (previous === 0) {
      return null;
    }

    return this.roundMoney(
      new Decimal(current).minus(previous).div(previous).mul(100).toNumber(),
    );
  }

  private roundMoney(value: number): number {
    return new Decimal(value).toDecimalPlaces(2).toNumber();
  }

  private formatMoneyText(value: number): string {
    return this.roundMoney(value)
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  private formatSignedPercent(value: number): string {
    const formatted = this.formatMoneyText(Math.abs(value));
    return `${value > 0 ? '+' : '-'}${formatted}%`;
  }

  private formatRelativeTime(timestamp: number, now: number): string {
    const diff = Math.max(now - timestamp, 0);
    const minute = 60 * 1000;
    const hour = 60 * minute;

    if (diff < minute) {
      return '刚刚';
    }

    if (diff < hour) {
      return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
    }

    if (diff < 24 * hour) {
      return `${Math.max(1, Math.floor(diff / hour))}小时前`;
    }

    return 'today';
  }
}
