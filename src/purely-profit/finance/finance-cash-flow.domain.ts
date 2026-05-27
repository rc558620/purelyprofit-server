import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  FinanceReportCashFlowRowDto,
} from './dto/finance-response.dto';
import {
  CASH_FLOW_CATEGORY_RULES,
  FINANCE_REPORT_PAYMENT_LABELS,
  type FinanceCashFlowCategoryRule,
} from './finance.constants';
import type { FinanceCashFlowStatsRow } from './finance.types';
import {
  addMoneyValues,
  formatReportDateLabel,
  roundMoneyValue,
  toMoneyNumber,
} from './finance.utils';

export function assertCashFlowCategoryCanCreateManually(
  category: string,
): void {
  const rule = getCashFlowCategoryRule(category);
  if (rule && !rule.allowManualCreate) {
    throw new ConflictException(
      rule.manualCreateError ?? `${rule.label}流水不允许手工录入`,
    );
  }
}

export function assertCashFlowDirectionMatchesCategory(
  direction: string,
  category: string,
): void {
  const rule = getCashFlowCategoryRule(category);
  if (rule && direction !== rule.direction) {
    throw new ConflictException('流水方向与分类口径不一致');
  }
}

export function getCashFlowCategoryRule(
  category: string,
): FinanceCashFlowCategoryRule | null {
  if (!(category in CASH_FLOW_CATEGORY_RULES)) {
    return null;
  }

  return CASH_FLOW_CATEGORY_RULES[
    category as keyof typeof CASH_FLOW_CATEGORY_RULES
  ];
}

export function mapCashFlowRecord(record: {
  id: number;
  direction: string;
  category: string;
  title: string;
  amount: Prisma.Decimal;
  payment: string;
  note: string | null;
  date: Date;
  createdAt: Date;
}): FinanceCashFlowRecordResponseDto {
  return {
    id: String(record.id),
    direction:
      record.direction as FinanceCashFlowRecordResponseDto['direction'],
    category: record.category as FinanceCashFlowRecordResponseDto['category'],
    title: record.title,
    amount: toMoneyNumber(record.amount),
    payment: record.payment as FinanceCashFlowRecordResponseDto['payment'],
    ...(record.note ? { note: record.note } : {}),
    date: record.date.getTime(),
    createdAt: record.createdAt.getTime(),
  };
}

export function buildCashFlowBaseStats(
  records: FinanceCashFlowStatsRow[],
): FinanceCashFlowStatsDto {
  let totalIncome = 0;
  let totalExpense = 0;

  for (const record of records) {
    const amount = toMoneyNumber(record.amount);
    if (record.direction === 'income') {
      totalIncome = addMoneyValues(totalIncome, amount);
    } else {
      totalExpense = addMoneyValues(totalExpense, amount);
    }
  }

  return {
    totalIncome,
    totalExpense,
    netFlow: roundMoneyValue(totalIncome - totalExpense),
    recordCount: records.length,
    compareLastPeriod: null,
  };
}

export function buildFinanceReportCashFlowRows(
  records: Array<{
    id: number;
    date: Date;
    title: string;
    direction: string;
    category: string;
    amount: Prisma.Decimal;
    payment: string;
  }>,
): FinanceReportCashFlowRowDto[] {
  return records.map((record) => ({
    id: String(record.id),
    dateLabel: formatReportDateLabel(record.date.getTime()),
    title: record.title,
    direction: record.direction,
    categoryLabel:
      getCashFlowCategoryRule(record.category)?.label ?? record.category,
    amount: toMoneyNumber(record.amount),
    paymentLabel:
      FINANCE_REPORT_PAYMENT_LABELS[record.payment] ?? record.payment,
  }));
}
