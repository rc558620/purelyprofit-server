import { buildFinanceReportSummary } from './finance-account-report.domain';
import {
  buildFinanceOverviewResponse,
  makeOverviewTotals,
} from './finance-overview.domain';
import { Money } from '../../shared/money.utils';

describe('财务报表聚合口径', () => {
  it('汇总走 SQL 聚合结果，明细行被截断时不影响金额与条数', () => {
    const summary = buildFinanceReportSummary({
      currentCashFlowTotals: [
        { direction: 'income', amount: 50_000 },
        { direction: 'expense', amount: 12_000 },
      ],
      // 真实 8000 条，远超明细查询上限；明细不再参与汇总，故不受影响
      currentCashFlowCount: 8000,
      previousCashFlowTotals: [
        { direction: 'income', amount: 30_000 },
        { direction: 'expense', amount: 10_000 },
      ],
      accountRecords: [],
    });

    expect(summary).toEqual({
      totalIncome: 500,
      totalExpense: 120,
      netCashFlow: 380,
      recordCount: 8000,
      receivableTotal: 0,
      payableTotal: 0,
      compareLastPeriod: 90,
    });
  });

  it('上期净收益为负时，环比变化率方向不会被符号翻转', () => {
    const currentTotals = makeOverviewTotals();
    const previousTotals = makeOverviewTotals();
    // 上期支出 1000、无收入 → 净收益 -1000（亏损）
    previousTotals.cost = Money.fromDbCents(100_000);
    // 本期支出 500、无收入 → 净收益 -500（亏损减半，实为改善）
    currentTotals.cost = Money.fromDbCents(50_000);

    const result = buildFinanceOverviewResponse({
      period: 'month',
      currentRange: { start: 0, end: 1_000 },
      currentTotals,
      previousTotals,
      incomeMap: new Map(),
      expenseMap: new Map(),
    });

    // 若分母取 -1000 会得到 -50%（显示为恶化），与事实相反
    expect(result.heroSummary.netIncome).toEqual({
      current: -500,
      previous: -1000,
      changeRate: 50,
    });
  });
});
