import { FinanceReconciliationStatus, Prisma } from '@prisma/client';
import type {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
} from './dto/finance-response.dto';
import type {
  FinanceReconciliationItemInput,
  FinanceReconciliationRecordWithItems,
  FinanceReconciliationsListQueryInput,
} from './finance.types';
import {
  addMoneyValues,
  isZeroValue,
  roundMoneyValue,
  toMoneyNumber,
  toPrismaDecimal,
  trimOptionalString,
} from './finance.utils';

export function filterReconciliations(
  records: FinanceReconciliationRecordWithItems[],
  query: FinanceReconciliationsListQueryInput,
): FinanceReconciliationRecordWithItems[] {
  const statusFilter = query.statusFilter ?? 'all';
  const typeFilter = query.typeFilter ?? 'all';
  const searchText = (query.searchText ?? '').trim().toLowerCase();

  return records.filter((record) => {
    if (statusFilter !== 'all' && record.status !== statusFilter) {
      return false;
    }
    if (typeFilter !== 'all' && record.type !== typeFilter) {
      return false;
    }
    if (searchText === '') {
      return true;
    }
    const searchIndex =
      `${record.title} ${record.counterpart ?? ''} ${record.note ?? ''}`
        .toLowerCase()
        .trim();
    return searchIndex.includes(searchText);
  });
}

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
  let totalDiffAmount = 0;

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
    totalDiffAmount = addMoneyValues(
      totalDiffAmount,
      Math.abs(toMoneyNumber(record.diffAmount)),
    );
  }

  return {
    totalCount: records.length,
    confirmedCount,
    discrepancyCount,
    adjustedCount,
    draftCount,
    totalDiffAmount,
    newThisMonth: records.filter(
      (record) => record.createdAt.getTime() >= monthStart.getTime(),
    ).length,
  };
}

export function normalizeCreateReconciliationStatus(
  requestedStatus: string | undefined,
  actualIncome: number,
  actualExpense: number,
  diffAmount: number,
): FinanceReconciliationStatus {
  if (
    requestedStatus === 'draft' &&
    actualIncome === 0 &&
    actualExpense === 0
  ) {
    return FinanceReconciliationStatus.draft;
  }

  return isZeroValue(diffAmount)
    ? FinanceReconciliationStatus.confirmed
    : FinanceReconciliationStatus.discrepancy;
}

export function buildReconciliationItemCreateInput(
  item: FinanceReconciliationItemInput,
): Prisma.FinanceReconciliationItemCreateWithoutReconciliationInput {
  const bookAmount = roundMoneyValue(item.bookAmount);
  const actualAmount = roundMoneyValue(item.actualAmount);
  return {
    description: item.description.trim(),
    bookAmount: toPrismaDecimal(bookAmount),
    actualAmount: toPrismaDecimal(actualAmount),
    difference: toPrismaDecimal(roundMoneyValue(actualAmount - bookAmount)),
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
    bookIncome: toMoneyNumber(record.bookIncome),
    bookExpense: toMoneyNumber(record.bookExpense),
    bookNet: toMoneyNumber(record.bookNet),
    actualIncome: toMoneyNumber(record.actualIncome),
    actualExpense: toMoneyNumber(record.actualExpense),
    actualNet: toMoneyNumber(record.actualNet),
    diffAmount: toMoneyNumber(record.diffAmount),
    items: record.items.map((item) => ({
      id: String(item.id),
      description: item.description,
      bookAmount: toMoneyNumber(item.bookAmount),
      actualAmount: toMoneyNumber(item.actualAmount),
      difference: toMoneyNumber(item.difference),
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
