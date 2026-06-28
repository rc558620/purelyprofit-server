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
import { trimOptionalString } from './finance-string.utils';

export function buildReconciliationStats(
  records: FinanceReconciliationRecordWithItems[],
): FinanceReconciliationStatsDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let confirmedCount = 0;
  let discrepancyCount = 0;
  let adjustedCount = 0;
  let draftCount = 0;
  let totalDiffAmount = Money.zero();

  for (const record of records) {
    switch (record.status) {
      case 'confirmed':
        confirmedCount += 1;
        break;
      case 'discrepancy':
        discrepancyCount += 1;
        break;
      case 'adjusted':
        adjustedCount += 1;
        break;
      case 'draft':
        draftCount += 1;
        break;
    }
    totalDiffAmount = totalDiffAmount.add(
      Money.fromDbCents(record.diffAmount).abs(),
    );
  }

  return {
    totalCount: records.length,
    confirmedCount,
    discrepancyCount,
    adjustedCount,
    draftCount,
    totalDiffAmount: totalDiffAmount.toOutputYuan(),
    newThisMonth: records.filter(
      (record) => record.createdAt.getTime() >= monthStart.getTime(),
    ).length,
  };
}

export function normalizeCreateReconciliationStatus(
  requestedStatus: string | undefined,
  actualIncome: Money,
  actualExpense: Money,
  diffAmount: Money,
): FinanceReconciliationStatus {
  if (
    requestedStatus === 'draft' &&
    actualIncome.isZero() &&
    actualExpense.isZero()
  ) {
    return FinanceReconciliationStatus.draft;
  }

  return diffAmount.isZero()
    ? FinanceReconciliationStatus.confirmed
    : FinanceReconciliationStatus.discrepancy;
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
    actualIncome: Money.fromDbCents(record.actualIncome).toOutputYuan(),
    actualExpense: Money.fromDbCents(record.actualExpense).toOutputYuan(),
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
    ...(record.operator ? { operator: record.operator } : {}),
    ...(record.note ? { note: record.note } : {}),
    date: record.date.getTime(),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  };
}
