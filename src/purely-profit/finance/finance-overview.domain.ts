import type {
  FinanceCompareDto,
  FinanceSourceGroupDto,
} from './dto/finance-shared.response.dto';
import type { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import type { FinanceOverviewPeriodValue } from './finance.types';
import {
  CASH_FLOW_CATEGORY_RULES,
  OVERVIEW_SOURCE_CONFIG,
  type FinanceCashFlowOverviewBucket,
  type FinancePeriodTotals,
} from './finance.constants';
import {
  formatMonthDay,
  formatMonthLabel,
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
} from './finance-date.utils';
import {
  Money,
  calcPercentChangeWithFallback,
  calcPercentOfTotal,
  calcPercentPointDiff,
  calcMoneyRatio,
} from '../../shared/money.utils';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;

export function makeOverviewTotals(): Record<
  FinanceCashFlowOverviewBucket,
  Money
> {
  return {
    sales: Money.zero(),
    additional: Money.zero(),
    cost: Money.zero(),
    purchase: Money.zero(),
  };
}

export function buildEmptyOverviewResponse(): FinanceOverviewResponseDto {
  const currentTotals = makeOverviewTotals();
  const previousTotals = makeOverviewTotals();
  const { incomeGroup, expenseGroup } =
    buildOverviewSourceGroups(currentTotals);

  return {
    heroSummary: buildOverviewHeroSummary(currentTotals, previousTotals),
    dailyTrend: [],
    trendGranularity: 'daily',
    incomeGroup,
    expenseGroup,
  };
}

export function getCashFlowOverviewBucket(
  category: string,
): FinanceCashFlowOverviewBucket | null {
  if (!(category in CASH_FLOW_CATEGORY_RULES)) {
    return null;
  }

  return CASH_FLOW_CATEGORY_RULES[
    category as keyof typeof CASH_FLOW_CATEGORY_RULES
  ].overviewBucket;
}

export function buildFinanceOverviewResponse(params: {
  period: FinanceOverviewPeriodValue;
  currentRange: { start: number; end: number };
  currentTotals: FinancePeriodTotals;
  previousTotals: FinancePeriodTotals;
  incomeMap: Map<number, Money>;
  expenseMap: Map<number, Money>;
}): FinanceOverviewResponseDto {
  const heroSummary = buildOverviewHeroSummary(
    params.currentTotals,
    params.previousTotals,
  );
  const isYearPeriod = params.period === 'year';
  const trendGranularity = isYearPeriod
    ? ('monthly' as const)
    : ('daily' as const);
  const trendSeries = isYearPeriod
    ? buildOverviewMonthlyTrend(
        params.currentRange.start,
        params.currentRange.end,
        params.incomeMap,
        params.expenseMap,
      )
    : buildOverviewDailyTrend(
        params.period,
        params.currentRange.start,
        params.currentRange.end,
        params.incomeMap,
        params.expenseMap,
      );
  const { incomeGroup, expenseGroup } = buildOverviewSourceGroups(
    params.currentTotals,
  );

  return {
    heroSummary,
    dailyTrend: trendSeries,
    trendGranularity,
    incomeGroup,
    expenseGroup,
  };
}

export function buildOverviewHeroSummary(
  currentTotals: Record<FinanceCashFlowOverviewBucket, Money>,
  previousTotals: Record<FinanceCashFlowOverviewBucket, Money>,
): FinanceOverviewResponseDto['heroSummary'] {
  const currentIncome = currentTotals.sales.add(currentTotals.additional);
  const currentExpense = currentTotals.cost.add(currentTotals.purchase);
  const currentNet = currentIncome.subtract(currentExpense);
  const previousIncome = previousTotals.sales.add(previousTotals.additional);
  const previousExpense = previousTotals.cost.add(previousTotals.purchase);
  const previousNet = previousIncome.subtract(previousExpense);
  const currentProfitRate = calcProfitRate(currentNet, currentIncome);
  const previousProfitRate = calcProfitRate(previousNet, previousIncome);

  return {
    netIncome: buildCompare(currentNet, previousNet),
    totalIncome: buildCompare(currentIncome, previousIncome),
    totalExpense: buildCompare(currentExpense, previousExpense),
    profitRate: {
      current: currentProfitRate,
      previous: previousProfitRate,
      // 利润率本身已是百分比，changeRate 是百分点差值（如 30% → 20% = -10pp）
      changeRate: calcPercentPointDiff(currentProfitRate, previousProfitRate),
    },
    incomeExpenseRatio: calcIncomeExpenseRatio(currentIncome, currentExpense),
  };
}

/** year 周期按月聚合趋势，金额统一在 Money（分）层运算，避免前端浮点累加 */
export function buildOverviewMonthlyTrend(
  start: number,
  end: number,
  incomeMap: Map<number, Money>,
  expenseMap: Map<number, Money>,
): FinanceOverviewResponseDto['dailyTrend'] {
  // start/end 已是上海时区 UTC 毫秒时间戳，直接加偏移读取上海年月分量
  // 不可调用 getShanghaiMonthStartMs：该函数返回「上海月 1 号零点」对应的 UTC 戳，
  // 再对其 .getUTCMonth() 会因 -8h 回退到上个月，导致整体前移一个月。
  const startD = new Date(start + SHANGHAI_OFFSET_MS);
  const endD = new Date(end + SHANGHAI_OFFSET_MS);
  const startMonth = startD.getUTCMonth(); // 0-based
  const startYear = startD.getUTCFullYear();
  const endMonth = endD.getUTCMonth();
  const endYear = endD.getUTCFullYear();
  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  const months = Math.max(1, Math.min(12, totalMonths));
  const items: FinanceOverviewResponseDto['dailyTrend'] = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const monthDate = new Date(Date.UTC(endYear, endMonth - index, 1));
    const monthStart = getShanghaiMonthStartMs(monthDate.getTime());
    const income = incomeMap.get(monthStart) ?? Money.zero();
    const expense = expenseMap.get(monthStart) ?? Money.zero();
    items.push({
      dateLabel: formatMonthLabel(monthDate.getUTCMonth() + 1),
      income: income.toOutputYuan(),
      expense: expense.toOutputYuan(),
      net: income.subtract(expense).toOutputYuan(),
    });
  }

  return items;
}

export function buildOverviewDailyTrend(
  period: FinanceOverviewPeriodValue,
  start: number,
  end: number,
  incomeMap: Map<number, Money>,
  expenseMap: Map<number, Money>,
): FinanceOverviewResponseDto['dailyTrend'] {
  const availableDays =
    Math.floor(
      (getShanghaiDayStartMs(end) - getShanghaiDayStartMs(start)) / 86_400_000,
    ) + 1;
  // 趋势窗口与 heroSummary 汇总窗口对齐：从周期起点到当天，不再人为 cap
  const days = Math.max(1, availableDays);
  const items: FinanceOverviewResponseDto['dailyTrend'] = [];

  for (let index = days - 1; index >= 0; index -= 1) {
    const dayStart = getShanghaiDayStartMs(end - index * 86_400_000);
    const income = incomeMap.get(dayStart) ?? Money.zero();
    const expense = expenseMap.get(dayStart) ?? Money.zero();
    items.push({
      dateLabel: formatMonthDay(dayStart),
      income: income.toOutputYuan(),
      expense: expense.toOutputYuan(),
      net: income.subtract(expense).toOutputYuan(),
    });
  }

  return items;
}

export function buildOverviewSourceGroups(
  totals: Record<FinanceCashFlowOverviewBucket, Money>,
): Pick<FinanceOverviewResponseDto, 'incomeGroup' | 'expenseGroup'> {
  const items = (
    Object.keys(OVERVIEW_SOURCE_CONFIG) as FinanceCashFlowOverviewBucket[]
  ).map((key) => ({
    type: key,
    label: OVERVIEW_SOURCE_CONFIG[key].label,
    amount: totals[key],
    direction: OVERVIEW_SOURCE_CONFIG[key].direction,
    color: OVERVIEW_SOURCE_CONFIG[key].color,
    icon: OVERVIEW_SOURCE_CONFIG[key].icon,
  }));
  const incomeItems = items.filter((item) => item.direction === 'income');
  const expenseItems = items.filter((item) => item.direction === 'expense');
  const incomeTotal = Money.sum(incomeItems.map((item) => item.amount));
  const expenseTotal = Money.sum(expenseItems.map((item) => item.amount));

  return {
    incomeGroup: buildOverviewSourceGroup('income', incomeTotal, incomeItems),
    expenseGroup: buildOverviewSourceGroup(
      'expense',
      expenseTotal,
      expenseItems,
    ),
  };
}

function buildOverviewSourceGroup(
  direction: 'income' | 'expense',
  total: Money,
  sourceItems: Array<{
    type: FinanceCashFlowOverviewBucket;
    label: string;
    amount: Money;
    direction: 'income' | 'expense';
    color: string;
    icon: string;
  }>,
): FinanceSourceGroupDto {
  return {
    direction,
    total: total.toOutputYuan(),
    items: sourceItems.map((item) => ({
      ...item,
      amount: item.amount.toOutputYuan(),
      percent: calcPercentOfTotal(item.amount.toDbCents(), total.toDbCents()),
    })),
  };
}

function buildCompare(current: Money, previous: Money): FinanceCompareDto {
  return {
    current: current.toOutputYuan(),
    previous: previous.toOutputYuan(),
    changeRate: previous.isZero()
      ? null
      : calcPercentChangeWithFallback(
          current.toOutputYuan(),
          previous.toOutputYuan(),
        ),
  };
}

function calcProfitRate(net: Money, income: Money): number {
  if (income.isZero()) {
    return 0;
  }

  return calcPercentOfTotal(net.toDbCents(), income.toDbCents());
}

function calcIncomeExpenseRatio(income: Money, expense: Money): number | null {
  if (expense.isZero()) {
    return null;
  }

  return calcMoneyRatio(income, expense);
}
