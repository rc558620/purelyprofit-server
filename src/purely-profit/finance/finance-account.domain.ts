import { ConflictException } from '@nestjs/common';
import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
} from './dto/finance-account.response.dto';
import {
  ACCOUNT_CATEGORY_RULES,
  type FinanceAccountCategoryRule,
} from './finance.constants';
import type {
  FinanceAccountRecordWithAmount,
  FinanceDerivedAccountFields,
} from './finance.types';
import { Money } from '../../shared/money.utils';

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
  amount: Money,
  paidAmount: Money,
  dueDate?: number,
): FinanceDerivedAccountFields {
  const remaining = amount.subtract(paidAmount);
  if (!remaining.isPositive()) {
    return {
      remaining: remaining.toDbCents(),
      status: FinanceAccountStatus.settled,
    };
  }
  if (dueDate != null && dueDate < Date.now()) {
    return {
      remaining: remaining.toDbCents(),
      status: FinanceAccountStatus.overdue,
    };
  }
  if (paidAmount.isPositive()) {
    return {
      remaining: remaining.toDbCents(),
      status: FinanceAccountStatus.partial,
    };
  }
  return {
    remaining: remaining.toDbCents(),
    status: FinanceAccountStatus.pending,
  };
}

export function withDerivedAccountFields(
  record: FinanceAccountRecordWithAmount,
): FinanceAccountRecordWithAmount {
  const amount = Money.fromDbCents(record.amount);
  const paidAmount = Money.fromDbCents(record.paidAmount);
  const derived = deriveAccountFields(
    amount,
    paidAmount,
    record.dueDate?.getTime() ?? undefined,
  );

  return {
    ...record,
    remaining: derived.remaining,
    status: derived.status,
  };
}

export function mapAccountRecord(
  record: FinanceAccountRecordWithAmount,
): FinanceAccountRecordResponseDto {
  const amount = Money.fromDbCents(record.amount);
  const paidAmount = Money.fromDbCents(record.paidAmount);
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
    amount: amount.toOutputYuan(),
    paidAmount: paidAmount.toOutputYuan(),
    remaining: Money.fromDbCents(derived.remaining).toOutputYuan(),
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
  let totalReceivable = Money.zero();
  let totalPayable = Money.zero();
  let overdueCount = 0;

  const derivedRecords = records.map((item) => withDerivedAccountFields(item));

  for (const record of derivedRecords) {
    if (record.status !== FinanceAccountStatus.settled) {
      const remaining = Money.fromDbCents(record.remaining);
      if (record.type === 'receivable') {
        totalReceivable = totalReceivable.add(remaining);
      } else {
        totalPayable = totalPayable.add(remaining);
      }
      if (record.status === FinanceAccountStatus.overdue) {
        overdueCount += 1;
      }
    }
  }

  return {
    totalReceivable: totalReceivable.toOutputYuan(),
    totalPayable: totalPayable.toOutputYuan(),
    netReceivable: totalReceivable.subtract(totalPayable).toOutputYuan(),
    overdueCount,
    newThisMonth: derivedRecords.filter(
      (record) => record.createdAt.getTime() >= monthStart.getTime(),
    ).length,
  };
}
