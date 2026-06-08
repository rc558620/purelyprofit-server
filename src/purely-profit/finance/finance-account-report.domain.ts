import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceReportAccountRowDto,
  FinanceReportResponseDto,
} from './dto/finance-report.response.dto';
import { buildFinanceReportCashFlowRows } from './finance-cash-flow.domain';
import {
  FINANCE_REPORT_ACCOUNT_STATUS_LABELS,
  FINANCE_REPORT_ACCOUNT_TYPE_LABELS,
} from './finance.constants';
import { formatReportDateLabel } from './finance-date.utils';
import {
  addMoneyValues,
  isZeroValue,
  roundMoneyValue,
  toMoneyNumber,
} from './finance-money.utils';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
} from './finance.types';
import { withDerivedAccountFields } from './finance-account.domain';

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

  for (const record of accountRecords.map((item) =>
    withDerivedAccountFields(item),
  )) {
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
