import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceReportAccountRowDto,
  FinanceReportCashFlowRowDto,
  FinanceReportResponseDto,
} from './dto/finance-report.response.dto';
import {
  buildFinanceReportCashFlowRows,
  mapFinanceReportCashFlowRow,
} from './finance-cash-flow.domain';
import {
  FINANCE_REPORT_ACCOUNT_STATUS_LABELS,
  FINANCE_REPORT_ACCOUNT_TYPE_LABELS,
} from './finance.constants';
import { formatReportDateTimeLabel } from './finance-date.utils';
import { Money, calcPercentChangeWithFallback } from '../../shared/money.utils';
import type {
  FinanceReportCashFlowRow,
  FinanceReportCashFlowTotals,
  FinanceReportOpenAccountTotals,
  FinanceReportRowsData,
} from './finance-overview-report.query';
import type { FinanceReportAccountRow } from './finance.types';
import { withDerivedAccountFields } from './finance-account.domain';

/**
 * 报表明细行 DTO 装配（对应独立的 rows 缓存 part）。
 *
 * 输出的是已经完全映射好的 DTO（日期已转 label 字符串、金额已转元），
 * 因此可以直接 JSON 序列化进 Redis：缓存读回来不需要再做 Date 反解，
 * 也就不会出现「从缓存命中的行时间字段变成字符串」这类隐式差异。
 */
export function buildFinanceReportRows(rows: FinanceReportRowsData): {
  cashFlowRows: FinanceReportCashFlowRowDto[];
  accountRows: FinanceReportAccountRowDto[];
} {
  return {
    cashFlowRows: buildFinanceReportCashFlowRows(rows.currentCashFlowRecords),
    accountRows: buildFinanceReportAccountRows(rows.accountRecords),
  };
}

export function buildFinanceReportSummary(params: {
  currentCashFlowTotals: FinanceReportCashFlowTotals;
  currentCashFlowCount: number;
  previousCashFlowTotals: FinanceReportCashFlowTotals;
  /** 未结清账款合计（SQL 聚合产出），不得改为对明细行累加 */
  openAccountTotals: FinanceReportOpenAccountTotals;
}): FinanceReportResponseDto['summary'] {
  let totalIncome = Money.zero();
  let totalExpense = Money.zero();
  let previousIncome = Money.zero();
  let previousExpense = Money.zero();

  for (const record of params.currentCashFlowTotals) {
    const amount = Money.fromDbCents(record.amount);
    if (record.direction === 'income') {
      totalIncome = totalIncome.add(amount);
    } else {
      totalExpense = totalExpense.add(amount);
    }
  }

  for (const record of params.previousCashFlowTotals) {
    const amount = Money.fromDbCents(record.amount);
    if (record.direction === 'income') {
      previousIncome = previousIncome.add(amount);
    } else {
      previousExpense = previousExpense.add(amount);
    }
  }

  const receivableTotal = Money.fromDbCents(
    params.openAccountTotals.receivableRemaining,
  );
  const payableTotal = Money.fromDbCents(
    params.openAccountTotals.payableRemaining,
  );

  const netCashFlow = totalIncome.subtract(totalExpense);
  const previousNetCashFlow = previousIncome.subtract(previousExpense);

  return {
    totalIncome: totalIncome.toOutputYuan(),
    totalExpense: totalExpense.toOutputYuan(),
    netCashFlow: netCashFlow.toOutputYuan(),
    recordCount: params.currentCashFlowCount,
    receivableTotal: receivableTotal.toOutputYuan(),
    payableTotal: payableTotal.toOutputYuan(),
    compareLastPeriod: previousNetCashFlow.isZero()
      ? null
      : calcPercentChangeWithFallback(
          netCashFlow.toOutputYuan(),
          previousNetCashFlow.toOutputYuan(),
          // 净现金流可为负：上期为负时直接作分母会翻转符号
          // （上期 -1000 → 本期 -500 会算成 -50%，实为改善），故取绝对值作基数。
          { absoluteBase: true },
        ),
  };
}

/** 财务报表 CSV 表头，列顺序必须与 buildFinanceReportCsvRows 逐列对齐 */
export const FINANCE_REPORT_CSV_HEADERS = [
  '日期',
  '标题',
  '收支方向',
  '分类',
  '金额',
  '支付方式',
];

/**
 * 单行 CSV 值组装（列顺序必须与 FINANCE_REPORT_CSV_HEADERS 对齐）。
 *
 * `\t` 前缀强制 Excel/WPS 按文本处理，避免日期/金额因列宽不足显示为 ####。
 */
export function buildFinanceReportCsvRow(
  row: FinanceReportCashFlowRowDto,
): unknown[] {
  return [
    `\t${row.dateLabel}`,
    row.title,
    row.direction,
    row.categoryLabel,
    `\t${row.amount}`,
    row.paymentLabel,
  ];
}

/**
 * 财务报表 CSV 行（惰性生成）。
 *
 * 用生成器而非 `map` 数组：不再额外分配一个中间行数组。
 */
export function* buildFinanceReportCsvRows(
  rows: Iterable<FinanceReportCashFlowRowDto>,
): Iterable<unknown[]> {
  for (const row of rows) {
    yield buildFinanceReportCsvRow(row);
  }
}

/**
 * 导出用异步行流：DB 明细（异步分批）→ CSV 值数组（逐行产出）。
 *
 * 数据侧与格式化侧都以流的方式串联，内存占用只与单批大小相关；
 * 调用方（`safeStreamCsvExportAsync`）拿到的是可直接逐行写出的异步迭代器。
 */
export async function* buildFinanceReportCsvRowStream(
  records: AsyncIterable<FinanceReportCashFlowRow>,
): AsyncIterable<unknown[]> {
  for await (const record of records) {
    yield buildFinanceReportCsvRow(mapFinanceReportCashFlowRow(record));
  }
}

export function buildFinanceReportAccountRows(
  records: FinanceReportAccountRow[],
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
