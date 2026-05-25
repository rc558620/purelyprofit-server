import Decimal from 'decimal.js';
import { toDecimalNumber, toTimestampMs } from '../../commerce/commerce.utils';
import {
  COST_CATEGORY_META,
  type CostRecordResponseSource,
  type CostReportCostRow,
  type CostReportPayrollRow,
  type CostReportCategoryFilterValue,
} from './costs.types';
import { getPayrollCostDate } from './costs.domain';
import type {
  CostRecordResponseDto,
  CostReportCategoryRowDto,
  CostReportDetailRowDto,
} from './dto/costs-response.dto';

export function buildCostRecordResponse(
  record: CostRecordResponseSource,
): CostRecordResponseDto {
  return {
    id: String(record.id),
    title: record.title,
    type: record.type,
    category: record.category,
    amount: toDecimalNumber(record.amount),
    date: toTimestampMs(record.date),
    ...(record.note ? { note: record.note } : {}),
    sourceType: record.sourceType,
    deletable: record.sourceType === 'manual',
    createdAt: toTimestampMs(record.createdAt),
  };
}

export function buildCostReportCategories(
  rows: CostReportCostRow[],
  total: number,
): CostReportCategoryRowDto[] {
  if (total <= 0) {
    return [];
  }

  const totals = new Map<CostReportCostRow['category'], Decimal>();
  for (const row of rows) {
    totals.set(
      row.category,
      (totals.get(row.category) ?? new Decimal(0)).plus(row.amount.toString()),
    );
  }

  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      label: COST_CATEGORY_META[category].label,
      amount: Number(amount.toFixed(2)),
      percentage: Number(
        amount.div(total).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      ),
      color: COST_CATEGORY_META[category].color,
    }))
    .sort((left, right) => right.amount - left.amount);
}

export function buildCostReportDetailRows(
  costRows: CostReportCostRow[],
  payrollRows: CostReportPayrollRow[],
  categoryFilter: CostReportCategoryFilterValue,
): CostReportDetailRowDto[] {
  if (categoryFilter === 'all') {
    return [];
  }

  const rows: CostReportDetailRowDto[] = costRows
    .filter((row) => row.category === categoryFilter)
    .map((row) => ({
      id: String(row.id),
      title: row.title,
      amount: toDecimalNumber(row.amount),
      date: toTimestampMs(row.date),
      dateLabel: formatCostReportDate(row.date),
      ...(row.note ? { note: row.note } : {}),
    }));

  if (categoryFilter === 'salary') {
    rows.push(
      ...payrollRows.map((row) => ({
        id: String(row.id),
        title: `[草稿] ${row.employeeName} ${row.month} 工资`,
        amount: toDecimalNumber(row.actualSalary),
        date: getPayrollCostDate(row.month).getTime(),
        dateLabel: row.month,
        ...(row.note ? { note: row.note } : {}),
      })),
    );
  }

  return rows.sort((left, right) => right.date - left.date);
}

function formatCostReportDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}
