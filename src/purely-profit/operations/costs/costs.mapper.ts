import { toTimestampMs } from '../../commerce/commerce.utils';
import { Money, calcPercentOfTotal } from '../../../shared/money.utils';
import {
  COST_CATEGORY_META,
  type CostRecordResponseSource,
  type CostReportCostRow,
  type CostReportPayrollRow,
  type CostReportCategoryFilterValue,
} from './costs.types';
import type {
  CostRecordResponseDto,
  CostReportCategoryRowDto,
  CostReportDetailRowDto,
  CostDashboardTrendDayDto,
} from './dto/costs-response.dto';

export function buildCostRecordResponse(
  record: CostRecordResponseSource,
): CostRecordResponseDto {
  return {
    id: String(record.id),
    title: record.title,
    type: record.type,
    category: record.category,
    amount: Money.fromDbCents(record.amount).toOutputYuan(),
    date: toTimestampMs(record.date),
    ...(record.note ? { note: record.note } : {}),
    sourceType: record.sourceType,
    deletable: record.sourceType === 'manual',
    createdAt: toTimestampMs(record.createdAt),
  };
}

export function buildCostReportCategories(
  categoryCents: Map<CostReportCostRow['category'], number>,
  total: number,
): CostReportCategoryRowDto[] {
  if (total <= 0) {
    return [];
  }

  return Array.from(categoryCents.entries())
    .map(([category, cents]) => {
      const amount = Money.fromDbCents(cents).toOutputYuan();
      return {
        label: COST_CATEGORY_META[category]?.label ?? category,
        amount,
        percentage: calcPercentOfTotal(amount, total),
        color: COST_CATEGORY_META[category]?.color ?? '#94a3b8',
      };
    })
    .sort((left, right) => right.amount - left.amount);
}

export function buildCostReportDetailRows(
  costRows: CostReportCostRow[],
  payrollRows: CostReportPayrollRow[],
  categoryFilter: CostReportCategoryFilterValue,
): CostReportDetailRowDto[] {
  // “all” 视图导出全部明细行，而非空数组
  const filteredRows =
    categoryFilter === 'all'
      ? costRows
      : costRows.filter((row) => row.category === categoryFilter);

  const rows: CostReportDetailRowDto[] = filteredRows.map((row) => ({
    id: String(row.id),
    title: row.title,
    amount: Money.fromDbCents(row.amount).toOutputYuan(),
    date: toTimestampMs(row.date),
    dateLabel: formatCostReportDate(row.date),
    ...(row.note ? { note: row.note } : {}),
  }));

  if (categoryFilter === 'salary') {
    rows.push(
      ...payrollRows.map((row) => {
        const monthLabel = formatPayrollMonth(row.month);
        return {
          id: String(row.id),
          title: `[草稿] ${row.employeeName} ${monthLabel} 工资`,
          amount: Money.fromDbCents(row.actualSalary).toOutputYuan(),
          date: row.month.getTime(),
          dateLabel: monthLabel,
          draft: true,
          ...(row.note ? { note: row.note } : {}),
        };
      }),
    );
  }

  return rows.sort((left, right) => right.date - left.date);
}

function formatCostReportDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function formatPayrollMonth(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 构建近 7 日成本趋势数据（后端聚合，全部分维度计算后再转元）。
 * rows 已按当前筛选条件过滤且已夹持历史窗口。
 */
export function buildCostDashboardTrend(
  rows: Array<Pick<CostReportCostRow, 'type' | 'category' | 'amount' | 'date'>>,
): CostDashboardTrendDayDto[] {
  const now = new Date();

  // 生成近 7 天的日期区间
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    const end = start + 86_400_000;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return {
      label: `${mm}/${dd}`,
      start,
      end,
      fixedCents: Money.zero(),
      variableCents: Money.zero(),
    };
  });

  // 在分维度按天、按类型累加
  for (const row of rows) {
    const rowTimestamp = row.date.getTime();
    const day = days.find(
      (d) => rowTimestamp >= d.start && rowTimestamp < d.end,
    );
    if (day == null) continue;
    const rowMoney = Money.fromDbCents(row.amount);
    if (row.type === 'fixed') {
      day.fixedCents = day.fixedCents.add(rowMoney);
    } else {
      day.variableCents = day.variableCents.add(rowMoney);
    }
  }

  return days.map((day) => ({
    date: day.start,
    label: day.label,
    fixed: day.fixedCents.toOutputYuan(),
    variable: day.variableCents.toOutputYuan(),
    total: day.fixedCents.add(day.variableCents).toOutputYuan(),
  }));
}
