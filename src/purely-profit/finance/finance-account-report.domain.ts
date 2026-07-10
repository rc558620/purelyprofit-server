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
import { formatReportDateTimeLabel } from './finance-date.utils';
import { Money, calcPercentChangeWithFallback } from '../../shared/money.utils';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
} from './finance.types';
import { withDerivedAccountFields } from './finance-account.domain';

export function buildFinanceReportResponse(params: {
  currentCashFlowRecords: Array<
    Pick<
      FinanceCashFlowRecordWithAmount,
      | 'id'
      | 'date'
      | 'createdAt'
      | 'title'
      | 'direction'
      | 'category'
      | 'amount'
      | 'payment'
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
  let totalIncome = Money.zero();
  let totalExpense = Money.zero();
  let previousIncome = Money.zero();
  let previousExpense = Money.zero();
  let receivableTotal = Money.zero();
  let payableTotal = Money.zero();

  for (const record of currentCashFlowRecords) {
    const amount = Money.fromDbCents(record.amount);
    if (record.direction === 'income') {
      totalIncome = totalIncome.add(amount);
    } else {
      totalExpense = totalExpense.add(amount);
    }
  }

  for (const record of previousCashFlowRecords) {
    const amount = Money.fromDbCents(record.amount);
    if (record.direction === 'income') {
      previousIncome = previousIncome.add(amount);
    } else {
      previousExpense = previousExpense.add(amount);
    }
  }

  for (const record of accountRecords.map((item) =>
    withDerivedAccountFields(item),
  )) {
    if (record.status === FinanceAccountStatus.settled) {
      continue;
    }
    const remaining = Money.fromDbCents(record.remaining);
    if (record.type === 'receivable') {
      receivableTotal = receivableTotal.add(remaining);
    } else {
      payableTotal = payableTotal.add(remaining);
    }
  }

  const netCashFlow = totalIncome.subtract(totalExpense);
  const previousNetCashFlow = previousIncome.subtract(previousExpense);

  return {
    totalIncome: totalIncome.toOutputYuan(),
    totalExpense: totalExpense.toOutputYuan(),
    netCashFlow: netCashFlow.toOutputYuan(),
    recordCount: currentCashFlowRecords.length,
    receivableTotal: receivableTotal.toOutputYuan(),
    payableTotal: payableTotal.toOutputYuan(),
    compareLastPeriod: previousNetCashFlow.isZero()
      ? null
      : calcPercentChangeWithFallback(
          netCashFlow.toOutputYuan(),
          previousNetCashFlow.toOutputYuan(),
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
      amount: Money.fromDbCents(record.amount).toOutputYuan(),
      remaining: Money.fromDbCents(record.remaining).toOutputYuan(),
      statusLabel:
        FINANCE_REPORT_ACCOUNT_STATUS_LABELS[record.status] ?? record.status,
      statusKey: record.status,
      dateLabel: formatReportDateTimeLabel(record.createdAt.getTime()),
    }));
}
