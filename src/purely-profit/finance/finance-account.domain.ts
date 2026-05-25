import { ConflictException } from '@nestjs/common';
import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  FinanceReportAccountRowDto,
  FinanceReportResponseDto,
} from './dto/finance-response.dto';
import { buildFinanceReportCashFlowRows } from './finance-cash-flow.domain';
import {
  ACCOUNT_CATEGORY_RULES,
  ACCOUNT_STATUS_ORDER,
  FINANCE_REPORT_ACCOUNT_STATUS_LABELS,
  FINANCE_REPORT_ACCOUNT_TYPE_LABELS,
  type FinanceAccountCategoryRule,
} from './finance.constants';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
  FinanceCashFlowRecordWithAmount,
  FinanceDerivedAccountFields,
} from './finance.types';
import {
  addMoneyValues,
  formatReportDateLabel,
  isZeroValue,
  roundMoneyValue,
  toMoneyNumber,
  toPrismaDecimal,
} from './finance.utils';

export function assertAccountCategoryCanCreateManually(category: string): void {
  const rule = getAccountCategoryRule(category);
  if (rule && !rule.allowManualCreate) {
    throw new ConflictException(
      rule.manualCreateError ?? `${rule.label}账款不允许手工录入`,
    );
  }
}

export function assertAccountTypeMatchesCategory(
  type: string,
  category: string,
): void {
  const rule = getAccountCategoryRule(category);
  if (rule && !rule.allowedTypes.includes(type as 'receivable' | 'payable')) {
    throw new ConflictException('账款类型与分类口径不一致');
  }
}

export function getAccountCategoryRule(
  category: string,
): FinanceAccountCategoryRule | null {
  if (!(category in ACCOUNT_CATEGORY_RULES)) {
    return null;
  }

  return ACCOUNT_CATEGORY_RULES[
    category as keyof typeof ACCOUNT_CATEGORY_RULES
  ];
}

export function deriveAccountFields(
  amount: number,
  paidAmount: number,
  dueDate?: number,
): FinanceDerivedAccountFields {
  const remaining = roundMoneyValue(amount - paidAmount);
  if (remaining <= 0) {
    return { remaining, status: FinanceAccountStatus.settled };
  }
  if (paidAmount > 0) {
    return { remaining, status: FinanceAccountStatus.partial };
  }
  if (dueDate && dueDate < Date.now()) {
    return { remaining, status: FinanceAccountStatus.overdue };
  }
  return { remaining, status: FinanceAccountStatus.pending };
}

export function withDerivedAccountFields(
  record: FinanceAccountRecordWithAmount,
): FinanceAccountRecordWithAmount {
  const amount = toMoneyNumber(record.amount);
  const paidAmount = toMoneyNumber(record.paidAmount);
  const derived = deriveAccountFields(
    amount,
    paidAmount,
    record.dueDate?.getTime() ?? undefined,
  );

  return {
    ...record,
    remaining: toPrismaDecimal(derived.remaining),
    status: derived.status,
  };
}

export function filterAndSortAccounts(
  records: FinanceAccountRecordWithAmount[],
  query: FinanceAccountsListQueryInput,
): FinanceAccountRecordWithAmount[] {
  const typeFilter = query.typeFilter ?? 'all';
  const statusFilter = query.statusFilter ?? 'all';
  const searchText = (query.searchText ?? '').trim().toLowerCase();

  return records
    .map((record) => withDerivedAccountFields(record))
    .filter((record) => {
      if (typeFilter !== 'all' && record.type !== typeFilter) {
        return false;
      }
      if (statusFilter !== 'all' && record.status !== statusFilter) {
        return false;
      }
      if (searchText === '') {
        return true;
      }
      const searchKey = `${record.counterpart} ${record.note ?? ''}`
        .toLowerCase()
        .trim();
      return searchKey.includes(searchText);
    })
    .sort((left, right) => {
      const statusDiff =
        ACCOUNT_STATUS_ORDER[left.status] - ACCOUNT_STATUS_ORDER[right.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
}

export function mapAccountRecord(
  record: FinanceAccountRecordWithAmount,
): FinanceAccountRecordResponseDto {
  const amount = toMoneyNumber(record.amount);
  const paidAmount = toMoneyNumber(record.paidAmount);
  const derived = deriveAccountFields(
    amount,
    paidAmount,
    record.dueDate?.getTime() ?? undefined,
  );

  return {
    id: String(record.id),
    type: record.type as FinanceAccountRecordResponseDto['type'],
    category: record.category as FinanceAccountRecordResponseDto['category'],
    counterpart: record.counterpart,
    amount,
    paidAmount,
    remaining: derived.remaining,
    status: derived.status,
    ...(record.dueDate ? { dueDate: record.dueDate.getTime() } : {}),
    date: record.date.getTime(),
    ...(record.note ? { note: record.note } : {}),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  };
}

export function buildAccountsStats(
  records: FinanceAccountRecordWithAmount[],
): FinanceAccountsStatsDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let totalReceivable = 0;
  let totalPayable = 0;
  let overdueCount = 0;

  for (const record of records.map((item) => withDerivedAccountFields(item))) {
    if (record.status !== FinanceAccountStatus.settled) {
      const remaining = toMoneyNumber(record.remaining);
      if (record.type === 'receivable') {
        totalReceivable = addMoneyValues(totalReceivable, remaining);
      } else {
        totalPayable = addMoneyValues(totalPayable, remaining);
      }
      if (record.status === FinanceAccountStatus.overdue) {
        overdueCount += 1;
      }
    }
  }

  return {
    totalReceivable,
    totalPayable,
    netReceivable: roundMoneyValue(totalReceivable - totalPayable),
    overdueCount,
    newThisMonth: records.filter(
      (record) => record.createdAt.getTime() >= monthStart.getTime(),
    ).length,
  };
}

export function buildFinanceReportResponse(params: {
  currentCashFlowRecords: Array<
    Pick<
      FinanceCashFlowRecordWithAmount,
      'id' | 'date' | 'title' | 'direction' | 'category' | 'amount' | 'payment'
    >
  >;
  previousCashFlowRecords: Array<
    Pick<FinanceCashFlowRecordWithAmount, 'direction' | 'amount'>
  >;
  accountRecords: FinanceAccountRecordWithAmount[];
}): FinanceReportResponseDto {
  return {
    summary: buildFinanceReportSummary(
      params.currentCashFlowRecords,
      params.previousCashFlowRecords,
      params.accountRecords,
    ),
    cashFlowRows: buildFinanceReportCashFlowRows(params.currentCashFlowRecords),
    accountRows: buildFinanceReportAccountRows(params.accountRecords),
  };
}

export function buildFinanceReportSummary(
  currentCashFlowRecords: Array<
    Pick<FinanceCashFlowRecordWithAmount, 'direction' | 'amount'>
  >,
  previousCashFlowRecords: Array<
    Pick<FinanceCashFlowRecordWithAmount, 'direction' | 'amount'>
  >,
  accountRecords: FinanceAccountRecordWithAmount[],
): FinanceReportResponseDto['summary'] {
  let totalIncome = 0;
  let totalExpense = 0;
  let previousIncome = 0;
  let previousExpense = 0;
  let receivableTotal = 0;
  let payableTotal = 0;

  for (const record of currentCashFlowRecords) {
    const amount = toMoneyNumber(record.amount);
    if (record.direction === 'income') {
      totalIncome = addMoneyValues(totalIncome, amount);
    } else {
      totalExpense = addMoneyValues(totalExpense, amount);
    }
  }

  for (const record of previousCashFlowRecords) {
    const amount = toMoneyNumber(record.amount);
    if (record.direction === 'income') {
      previousIncome = addMoneyValues(previousIncome, amount);
    } else {
      previousExpense = addMoneyValues(previousExpense, amount);
    }
  }

  for (const record of accountRecords.map((item) => withDerivedAccountFields(item))) {
    if (record.status === FinanceAccountStatus.settled) {
      continue;
    }
    const remaining = toMoneyNumber(record.remaining);
    if (record.type === 'receivable') {
      receivableTotal = addMoneyValues(receivableTotal, remaining);
    } else {
      payableTotal = addMoneyValues(payableTotal, remaining);
    }
  }

  const netCashFlow = roundMoneyValue(totalIncome - totalExpense);
  const previousNetCashFlow = roundMoneyValue(previousIncome - previousExpense);

  return {
    totalIncome,
    totalExpense,
    netCashFlow,
    recordCount: currentCashFlowRecords.length,
    receivableTotal,
    payableTotal,
    compareLastPeriod: isZeroValue(previousNetCashFlow)
      ? null
      : roundMoneyValue(
          ((netCashFlow - previousNetCashFlow) /
            Math.abs(previousNetCashFlow)) *
            100,
        ),
  };
}

export function buildFinanceReportAccountRows(
  records: FinanceAccountRecordWithAmount[],
): FinanceReportAccountRowDto[] {
  return records
    .map((record) => withDerivedAccountFields(record))
    .filter((record) => record.status !== FinanceAccountStatus.settled)
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id - left.id,
    )
    .map((record) => ({
      id: String(record.id),
      type: record.type,
      typeLabel: FINANCE_REPORT_ACCOUNT_TYPE_LABELS[record.type] ?? record.type,
      counterpart: record.counterpart,
      amount: toMoneyNumber(record.amount),
      remaining: toMoneyNumber(record.remaining),
      statusLabel:
        FINANCE_REPORT_ACCOUNT_STATUS_LABELS[record.status] ?? record.status,
      statusKey: record.status,
      dateLabel: formatReportDateLabel(record.date.getTime()),
    }));
}
