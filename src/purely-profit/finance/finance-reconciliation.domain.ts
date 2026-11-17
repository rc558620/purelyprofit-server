import { FinanceReconciliationStatus, Prisma } from '@prisma/client';
import type {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
} from './dto/finance-reconciliation.response.dto';
import type {
  FinanceReconciliationItemInput,
  FinanceReconciliationRecordWithItems,
} from './finance.types';
import { Money } from '../../shared/money.utils';
import type { FinanceReconciliationStatsRow } from './finance-reconciliation.query';
import { trimOptionalString } from './finance-string.utils';

/**
 * 由 DB 聚合行组装对账统计卡。
 *
 * 状态计数、差异合计（已排除 draft 占位值）、本月新增全部由 SQL 算好，
 * 本函数只做纯映射，不再持有对账记录与明细项。
 */
export function buildReconciliationStats(
  rows: FinanceReconciliationStatsRow[],
): FinanceReconciliationStatsDto {
  let totalCount = 0;
  let confirmedCount = 0;
  let discrepancyCount = 0;
  let adjustedCount = 0;
  let draftCount = 0;
  let newThisMonth = 0;
  let totalDiffAmount = Money.zero();

  for (const row of rows) {
    totalCount += row.count;
    newThisMonth += row.newThisMonth;
    totalDiffAmount = totalDiffAmount.add(Money.fromDbCents(row.diffTotal));
    switch (row.status) {
      case 'confirmed':
        confirmedCount += row.count;
        break;
      case 'discrepancy':
        discrepancyCount += row.count;
        break;
      case 'adjusted':
        adjustedCount += row.count;
        break;
      case 'draft':
        draftCount += row.count;
        break;
    }
  }

  return {
    totalCount,
    confirmedCount,
    discrepancyCount,
    adjustedCount,
    draftCount,
    totalDiffAmount: totalDiffAmount.toOutputYuan(),
    newThisMonth,
  };
}

/**
 * 统一派生对账单金额与状态：后端是唯一真相源，前端不再传 status。
 *
 * 规则：
 * - actualIncome / actualExpense 均为 null → draft
 * - 任一实际金额有值 → 进入核算，空的一侧按 0 算
 * - diffAmount === 0 → confirmed
 * - diffAmount !== 0 → discrepancy
 */
export function deriveReconciliationAmountsAndStatus(
  bookIncome: Money,
  bookExpense: Money,
  actualIncome: Money | null,
  actualExpense: Money | null,
): {
  bookNet: Money;
  actualNet: Money;
  diffAmount: Money;
  status: FinanceReconciliationStatus;
} {
  const bookNet = bookIncome.subtract(bookExpense);

  // 两个实际金额都未录入 → 草稿
  const isDraft = actualIncome === null && actualExpense === null;
  if (isDraft) {
    return {
      bookNet,
      actualNet: Money.zero(),
      diffAmount: bookNet.negate(),
      status: FinanceReconciliationStatus.draft,
    };
  }

  // 至少录入了一侧，空的一侧按 0
  const resolvedActualIncome = actualIncome ?? Money.zero();
  const resolvedActualExpense = actualExpense ?? Money.zero();
  const actualNet = resolvedActualIncome.subtract(resolvedActualExpense);
  const diffAmount = actualNet.subtract(bookNet);

  return {
    bookNet,
    actualNet,
    diffAmount,
    status: diffAmount.isZero()
      ? FinanceReconciliationStatus.confirmed
      : FinanceReconciliationStatus.discrepancy,
  };
}

export function buildReconciliationItemCreateInput(
  item: FinanceReconciliationItemInput,
): Prisma.FinanceReconciliationItemCreateWithoutReconciliationInput {
  const bookAmount = Money.fromInputYuan(item.bookAmount).toDbCents();
  const actualAmount = Money.fromInputYuan(item.actualAmount).toDbCents();
  return {
    description: item.description.trim(),
    bookAmount,
    actualAmount,
    difference: Money.fromInputYuan(item.actualAmount)
      .subtract(Money.fromInputYuan(item.bookAmount))
      .toDbCents(),
    note: trimOptionalString(item.note),
  };
}

export function mapReconciliationRecord(
  record: FinanceReconciliationRecordWithItems,
): FinanceReconciliationRecordResponseDto {
  return {
    id: String(record.id),
    title: record.title,
    type: record.type,
    status: record.status,
    ...(record.channel ? { channel: record.channel } : {}),
    ...(record.counterpart ? { counterpart: record.counterpart } : {}),
    periodStart: record.periodStart.getTime(),
    periodEnd: record.periodEnd.getTime(),
    bookIncome: Money.fromDbCents(record.bookIncome).toOutputYuan(),
    bookExpense: Money.fromDbCents(record.bookExpense).toOutputYuan(),
    bookNet: Money.fromDbCents(record.bookNet).toOutputYuan(),
    ...(record.actualIncome != null
      ? { actualIncome: Money.fromDbCents(record.actualIncome).toOutputYuan() }
      : {}),
    ...(record.actualExpense != null
      ? {
          actualExpense: Money.fromDbCents(record.actualExpense).toOutputYuan(),
        }
      : {}),
    actualNet: Money.fromDbCents(record.actualNet).toOutputYuan(),
    diffAmount: Money.fromDbCents(record.diffAmount).toOutputYuan(),
    items: record.items.map((item) => ({
      id: String(item.id),
      description: item.description,
      bookAmount: Money.fromDbCents(item.bookAmount).toOutputYuan(),
      actualAmount: Money.fromDbCents(item.actualAmount).toOutputYuan(),
      difference: Money.fromDbCents(item.difference).toOutputYuan(),
      ...(item.note ? { note: item.note } : {}),
    })),
    ...(record.adjustNote ? { adjustNote: record.adjustNote } : {}),
    ...(record.settlementBatchNo
      ? { settlementBatchNo: record.settlementBatchNo }
      : {}),
    ...(record.linkedOrderNos
      ? {
          linkedOrderNos: record.linkedOrderNos
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
    ...(record.linkedOrderCount != null
      ? { linkedOrderCount: record.linkedOrderCount }
      : {}),
    ...(record.linkedReceivableAmount != null
      ? {
          linkedReceivableAmount: Money.fromDbCents(
            record.linkedReceivableAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(record.linkedSettledAmount != null
      ? {
          linkedSettledAmount: Money.fromDbCents(
            record.linkedSettledAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(record.linkedFeeAmount != null
      ? {
          linkedFeeAmount: Money.fromDbCents(
            record.linkedFeeAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(record.operator ? { operator: record.operator } : {}),
    ...(record.note ? { note: record.note } : {}),
    date: record.date.getTime(),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  };
}
