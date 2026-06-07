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
import { FINANCE_OVERVIEW_DISPLAY_DAYS } from './finance.types';
import { formatMonthDay, getDayStart } from './finance-date.utils';
import {
  addMoneyValues,
  calcPercent,
  isZeroValue,
  roundMoneyValue,
  subtractMoneyValues,
} from './finance-money.utils';

export function makeOverviewTotals(): FinancePeriodTotals {
  return {
    sales: 0,
    additional: 0,
    cost: 0,
    purchase: 0,
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
  incomeMap: Map<number, number>;
  expenseMap: Map<number, number>;
}): FinanceOverviewResponseDto {
  const heroSummary = buildOverviewHeroSummary(
    params.currentTotals,
    params.previousTotals,
  );
  const dailyTrend = buildOverviewDailyTrend(
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
    dailyTrend,
    incomeGroup,
    expenseGroup,
  };
}

export function buildOverviewHeroSummary(
  currentTotals: FinancePeriodTotals,
  previousTotals: FinancePeriodTotals,
): FinanceOverviewResponseDto['heroSummary'] {
  const currentIncome = addMoneyValues(
    currentTotals.sales,
    currentTotals.additional,
  );
  const currentExpense = addMoneyValues(
    currentTotals.cost,
    currentTotals.purchase,
  );
  const currentNet = subtractMoneyValues(currentIncome, currentExpense);
  const previousIncome = addMoneyValues(
    previousTotals.sales,
    previousTotals.additional,
  );
  const previousExpense = addMoneyValues(
    previousTotals.cost,
    previousTotals.purchase,
  );
  const previousNet = subtractMoneyValues(previousIncome, previousExpense);
  const currentProfitRate = calcProfitRate(currentNet, currentIncome);
  const previousProfitRate = calcProfitRate(previousNet, previousIncome);

  return {
    netIncome: buildCompare(currentNet, previousNet),
    totalIncome: buildCompare(currentIncome, previousIncome),
    totalExpense: buildCompare(currentExpense, previousExpense),
    profitRate: {
      current: currentProfitRate,
      previous: previousProfitRate,
      changeRate: roundMoneyValue(currentProfitRate - previousProfitRate),
    },
    incomeExpenseRatio: calcIncomeExpenseRatio(currentIncome, currentExpense),
  };
}

export function buildOverviewDailyTrend(
  period: FinanceOverviewPeriodValue,
  start: number,
  end: number,
  incomeMap: Map<number, number>,
  expenseMap: Map<number, number>,
): FinanceOverviewResponseDto['dailyTrend'] {
  const availableDays =
    Math.floor((getDayStart(end) - getDayStart(start)) / 86_400_000) + 1;
  const days = Math.max(
    1,
    Math.min(FINANCE_OVERVIEW_DISPLAY_DAYS[period], availableDays),
  );
  const items: FinanceOverviewResponseDto['dailyTrend'] = [];

  for (let index = days - 1; index >= 0; index -= 1) {
    const dayStart = getDayStart(end - index * 86_400_000);
    const income = incomeMap.get(dayStart) ?? 0;
    const expense = expenseMap.get(dayStart) ?? 0;
    items.push({
      dateLabel: formatMonthDay(dayStart),
      income,
      expense,
      net: subtractMoneyValues(income, expense),
    });
  }

  return items;
}

export function buildOverviewSourceGroups(
  totals: FinancePeriodTotals,
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
  const incomeTotal = incomeItems.reduce(
    (sum, item) => addMoneyValues(sum, item.amount),
    0,
  );
  const expenseTotal = expenseItems.reduce(
    (sum, item) => addMoneyValues(sum, item.amount),
    0,
  );

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
  total: number,
  sourceItems: Array<{
    type: FinanceCashFlowOverviewBucket;
    label: string;
    amount: number;
    direction: 'income' | 'expense';
    color: string;
    icon: string;
  }>,
): FinanceSourceGroupDto {
  return {
    direction,
    total,
    items: sourceItems.map((item) => ({
      ...item,
      percent: calcPercent(item.amount, total),
    })),
  };
}

function buildCompare(current: number, previous: number): FinanceCompareDto {
  return {
    current,
    previous,
    changeRate: isZeroValue(previous)
      ? null
      : roundMoneyValue(((current - previous) / previous) * 100),
  };
}

function calcProfitRate(net: number, income: number): number {
  if (isZeroValue(income)) {
    return 0;
  }

  return roundMoneyValue((net / income) * 100);
}

function calcIncomeExpenseRatio(
  income: number,
  expense: number,
): number | null {
  if (isZeroValue(expense)) {
    return null;
  }

  return roundMoneyValue(income / expense);
}
