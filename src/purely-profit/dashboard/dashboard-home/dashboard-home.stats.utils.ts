import {
  calcPercentChange,
  subtractMoneyValues,
} from '../../commerce/commerce.utils';
import type { DashboardHomeStatsDto } from './dto/dashboard-home-response.dto';
import { PERIOD_META } from './dashboard-home.constants';
import type {
  AggregatedCostsResult,
  AggregatedSalesResult,
  DashboardHomePeriodValue,
} from './dashboard-home.types';

export function buildDashboardHomeStats(
  period: DashboardHomePeriodValue,
  currentSales: AggregatedSalesResult,
  compareSales: AggregatedSalesResult,
  currentCosts: AggregatedCostsResult,
  compareCosts: AggregatedCostsResult,
): DashboardHomeStatsDto {
  const meta = PERIOD_META[period];
  const currentProfit = subtractMoneyValues(
    currentSales.revenue,
    currentCosts.totalCost,
  );
  const compareProfit = subtractMoneyValues(
    compareSales.revenue,
    compareCosts.totalCost,
  );

  return {
    profitLabel: meta.profitLabel,
    profit: currentProfit,
    profitChange: calcPercentChange(currentProfit, compareProfit),
    profitCompareLabel: meta.compareLabel,
    orderLabel: meta.orderLabel,
    orderCount: currentSales.orderCount,
    orderChange: calcPercentChange(
      currentSales.orderCount,
      compareSales.orderCount,
    ),
    orderCompareLabel: meta.compareLabel,
  };
}
