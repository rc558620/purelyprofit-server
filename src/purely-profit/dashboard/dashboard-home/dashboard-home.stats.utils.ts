import { calcPercentChange } from '../../commerce/commerce.utils';
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
  // 净利润 = 商品利润总和（售价 − 成本价，销售行快照） − 费用记录（成本管理），
  // 避免重复扣除商品成本（收入 − 费用会遗漏商品成本价）
  const currentProfit = Money.fromInputYuan(currentSales.profit)
    .subtract(Money.fromInputYuan(currentCosts.totalCost))
    .toOutputYuan();
  const compareProfit = Money.fromInputYuan(compareSales.profit)
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
