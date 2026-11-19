import { calcPercentChange } from '../../commerce/commerce.utils';
import { calcProfitCompare, Money } from '../../../shared/money.utils';
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
    /*
     * 净利润可正可负，不能直接拿上期值当分母：上期亏损 ¥100、这期亏损 ¥50 时
     * (current - previous) / previous 会得到 -50%，看起来像「下跌」，实际是减亏。
     * 统一走上期绝对值为分母的口径（减亏为正、增亏为负），与利润详情页一致；
     * 上期为 0 仍返回 null，由前端显示「暂无对比数据」。订单数非负，保持原算法。
     */
    profitChange: calcProfitCompare(currentProfit, compareProfit).percent,
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
