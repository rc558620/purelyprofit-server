import { Money } from '../../shared/money.utils';
import { calculatePercentChange } from './dashboard-math.utils';
import {
  DASHBOARD_PERIOD_MONTH,
  DASHBOARD_PERIOD_TODAY,
} from './dashboard.constants';
import {
  buildDateRange,
  buildHomeRevenueRange,
  buildPreviousSequentialRange,
  buildSingleDayRange,
  DAY_MS,
  getInclusiveDayCount,
  isTimeInRange,
  type TimeRange,
} from './dashboard-time.utils';
import {
  buildRevenueTrend,
  toRevenueAmountDisplay,
} from './dashboard-revenue.utils';
import type { DashboardRevenueOrderRow } from './dashboard.types';
import type { PulseHomeRevenuePeriodValue } from './dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardRevenueSummaryDto,
  PulseDashboardRevenueTrendDto,
} from './dto/pulse-dashboard-home.response.dto';

/** 首页营收所需的「当前周期 + 环比周期」区间对 */
export interface HomeRevenueRange {
  currentRange: TimeRange;
  previousRange: TimeRange;
}

export interface HomeRevenueTrendResult {
  revenueTrend: PulseDashboardRevenueTrendDto;
  revenueSummary: PulseDashboardRevenueSummaryDto;
}

/** 首页营收区间来源：既定周期 + 自定义日期 / 区间，二者互斥，自定义优先。 */
export interface HomeRevenueRangeParams {
  period: PulseHomeRevenuePeriodValue;
  /** 自定义单日 yyyy-MM-dd，传了它时忽略 period 区间 */
  customDate?: string | undefined;
  /** 自定义区间开始日 yyyy-MM-dd，需与 customRangeEnd 成对传入 */
  customRangeStart?: string | undefined;
  /** 自定义区间结束日 yyyy-MM-dd，需与 customRangeStart 成对传入 */
  customRangeEnd?: string | undefined;
}

/** 首页营收区间方案：在「当前 + 环比」之上给出趋势图的分桶粒度。 */
export interface HomeRevenueRangePlan extends HomeRevenueRange {
  /** 单日 / 今日按小时分桶，区间与既定周期按天分桶 */
  displayPeriod: PulseHomeRevenuePeriodValue;
}

/**
 * 解析首页营收区间。
 *
 * 优先级：自定义单日 > 自定义区间 > 既定周期。
 * 自定义单日的环比取前一天，自定义区间的环比取等长的前一段窗口，
 * 与 revenue-detail 的口径保持一致。
 */
export function resolveHomeRevenueRangePlan(
  params: HomeRevenueRangeParams,
  now: Date,
): HomeRevenueRangePlan {
  const { customDate, customRangeStart, customRangeEnd } = params;

  if (customDate) {
    const currentRange = buildSingleDayRange(customDate);
    return {
      currentRange,
      previousRange: {
        start: currentRange.start - DAY_MS,
        end: currentRange.end - DAY_MS,
      },
      displayPeriod: DASHBOARD_PERIOD_TODAY,
    };
  }

  if (customRangeStart && customRangeEnd) {
    const currentRange = buildDateRange(customRangeStart, customRangeEnd);
    return {
      currentRange,
      previousRange: buildPreviousSequentialRange(currentRange),
      displayPeriod: DASHBOARD_PERIOD_MONTH,
    };
  }

  const displayPeriod = params.period;
  const currentRange = buildHomeRevenueRange(displayPeriod, now);
  return {
    currentRange,
    previousRange: buildPreviousSequentialRange(currentRange, displayPeriod),
    displayPeriod,
  };
}

/**
 * 首页营收趋势 + 汇总。
 *
 * 订单查询范围是「当前区间 ∪ 环比区间」，这里在内存里按区间再切分，
 * 保证趋势只含当前区间、环比只取上一区间，两者口径不重叠。
 *
 * 金额原始值统一为数据库分：DTO 与 Dashboard / revenue-detail 共用同一套数字口径，
 * 展示值一律走 `xxxDisplay`，不允许出现「元原始值 + 分注释」的单位漂移。
 */
export function buildHomeRevenueTrend(
  orders: DashboardRevenueOrderRow[],
  plan: HomeRevenueRangePlan,
): HomeRevenueTrendResult {
  const { currentRange, previousRange, displayPeriod } = plan;
  const periodOrders = orders.filter((order) =>
    isTimeInRange(order.createdAt, currentRange),
  );
  const previousTotalCents = orders
    .filter((order) => isTimeInRange(order.createdAt, previousRange))
    .reduce((sum, order) => sum + order.amount, 0);
  const dayCount = getInclusiveDayCount(currentRange);
  const totalMoney = Money.sum(
    periodOrders.map((order) => Money.fromDbCents(order.amount)),
  );
  const totalCents = totalMoney.toDbCents();
  const avgMoney = totalMoney.divide(dayCount);

  return {
    revenueTrend: buildRevenueTrend(periodOrders, displayPeriod),
    revenueSummary: {
      total: totalCents,
      totalDisplay: toRevenueAmountDisplay(totalCents),
      avg: avgMoney.toDbCents(),
      avgDisplay: toRevenueAmountDisplay(avgMoney.toDbCents()),
      growth:
        calculatePercentChange(totalCents, previousTotalCents, {
          fallback: 0,
        }) ?? 0,
    },
  };
}
