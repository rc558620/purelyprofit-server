import { ConflictException } from '@nestjs/common';
import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
} from './dto/finance-account.response.dto';
import {
  ACCOUNT_CATEGORY_RULES,
  ACCOUNT_STATUS_ORDER,
  type FinanceAccountCategoryRule,
} from './finance.constants';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
  FinanceDerivedAccountFields,
} from './finance.types';
import {
  addMoneyValues,
  roundMoneyValue,
  toMoneyNumber,
  toPrismaDecimal,
} from './finance-money.utils';
import { buildPaginationState, paginateArray } from './finance-pagination.utils';

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

function getAccountCategoryRule(
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
      const updatedAtDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }
      return right.id - left.id;
    });
}

export function paginateAccounts(
  records: FinanceAccountRecordWithAmount[],
  page?: number,
  pageSize?: number,
): FinanceAccountRecordWithAmount[] {
  const pageState = buildPaginationState(page, pageSize);
  return paginateArray(records, pageState);
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
