import {
  calcPercentChange,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
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
  const currentProfit = Money.fromInputYuan(currentSales.revenue)
    .subtract(Money.fromInputYuan(currentCosts.totalCost))
    .toOutputYuan();
  const compareProfit = Money.fromInputYuan(compareSales.revenue)
    .subtract(Money.fromInputYuan(compareCosts.totalCost))
    .toOutputYuan();

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
