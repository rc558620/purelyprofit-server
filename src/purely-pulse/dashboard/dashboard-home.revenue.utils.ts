import { Money } from '../../shared/money.utils';
import { calculatePercentChange } from './dashboard-math.utils';
import {
  buildHomeRevenueRange,
  buildPreviousSequentialRange,
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

export function buildHomeRevenueRangePair(
  period: PulseHomeRevenuePeriodValue,
  now: Date,
): HomeRevenueRange {
  const currentRange = buildHomeRevenueRange(period, now);
  const previousRange = buildPreviousSequentialRange(currentRange, period);

  return {
    currentRange,
    previousRange,
  };
}

/**
 * 首页营收趋势 + 汇总。
 *
 * 订单查询范围是「当前周期 ∪ 环比周期」，这里在内存里按区间再切分，
 * 保证趋势只含当前周期、环比只取上一周期，两者口径不重叠。
 */
export function buildHomeRevenueTrend(
  orders: DashboardRevenueOrderRow[],
  period: PulseHomeRevenuePeriodValue,
  now: Date,
): HomeRevenueTrendResult {
  const { currentRange, previousRange } = buildHomeRevenueRangePair(
    period,
    now,
  );
  const periodOrders = orders.filter((order) =>
    isTimeInRange(order.createdAt, currentRange),
  );
  const previousTotal = orders
    .filter((order) => isTimeInRange(order.createdAt, previousRange))
    .reduce((sum, order) => sum + order.amount, 0);
  const dayCount = getInclusiveDayCount(currentRange);
  const totalMoney = Money.sum(
    periodOrders.map((order) => Money.fromDbCents(order.amount)),
  );
  const total = totalMoney.toOutputYuan();

  return {
    revenueTrend: buildRevenueTrend(periodOrders, period, (amountFen) =>
      Money.fromDbCents(amountFen).toOutputYuan(),
    ),
    revenueSummary: {
      total,
      totalDisplay: toRevenueAmountDisplay(totalMoney.toDbCents()),
      avg: Math.round(total / dayCount),
      avgDisplay: toRevenueAmountDisplay(
        totalMoney.divide(dayCount).toDbCents(),
      ),
      growth:
        calculatePercentChange(totalMoney.toDbCents(), previousTotal, {
          fallback: 0,
        }) ?? 0,
    },
  };
}
