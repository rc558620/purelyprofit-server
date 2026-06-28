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
import { Money, calcPercentChangeWithFallback, calcPercentOfTotal } from '../../shared/money.utils';

export function makeOverviewTotals(): Record<FinanceCashFlowOverviewBucket, Money> {
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
      changeRate: currentProfitRate - previousProfitRate,
    },
    incomeExpenseRatio: calcIncomeExpenseRatio(currentIncome, currentExpense),
  };
}

export function buildOverviewDailyTrend(
  period: FinanceOverviewPeriodValue,
  start: number,
  end: number,
  incomeMap: Map<number, Money>,
  expenseMap: Map<number, Money>,
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
      : calcPercentChangeWithFallback(current.toOutputYuan(), previous.toOutputYuan()),
  };
}

function calcProfitRate(net: Money, income: Money): number {
  if (income.isZero()) {
    return 0;
  }

  return calcPercentOfTotal(net.toDbCents(), income.toDbCents());
}

function calcIncomeExpenseRatio(
  income: Money,
  expense: Money,
): number | null {
  if (expense.isZero()) {
    return null;
  }

  return Math.round((income.toDbCents() / expense.toDbCents()) * 100) / 100;
}
