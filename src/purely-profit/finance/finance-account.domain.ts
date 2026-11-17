import { ConflictException } from '@nestjs/common';
import { FinanceAccountStatus } from '@prisma/client';
import type {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
} from './dto/finance-account.response.dto';
import {
  ACCOUNT_CATEGORY_RULES,
  DAY_MS,
  type FinanceAccountCategoryRule,
} from './finance.constants';
import type {
  FinanceAccountRecordWithAmount,
  FinanceDerivedAccountFields,
} from './finance.types';
import { Money } from '../../shared/money.utils';
import type { FinanceAccountStatsAggregate } from './finance-account-stats.query';

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
  // dueDate 为到期日当天零点时间戳：到期日当天仍属正常，次日零点起才算逾期。
  // 若直接比较 dueDate < now，则"今天到期"的账款从当天零点就被误判为逾期。
  if (dueDate != null && dueDate + DAY_MS <= Date.now()) {
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

/**
 * 补齐派生字段（remaining / status）。
 *
 * 泛型入参：报表只查字段子集，无法满足整行类型；传子集会原样透传其余字段，
 * 避免为了「补两个派生字段」把无用列也一起查出来。
 */
export function withDerivedAccountFields<
  T extends Pick<
    FinanceAccountRecordWithAmount,
    'amount' | 'paidAmount' | 'dueDate'
  >,
>(record: T): T & FinanceDerivedAccountFields {
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

/**
 * 由 DB 聚合结果组装账款统计卡。
 *
 * 统计口径不再依赖逐行派生：未结清余额、逾期笔数、本月新增都由 SQL 算好，
 * 本函数只做「分 → 元」的展示层换算，保持纯函数、可单测。
 */
export function buildAccountsStatsFromAggregate(
  aggregate: FinanceAccountStatsAggregate,
): FinanceAccountsStatsDto {
  const totalReceivable = Money.fromDbCents(aggregate.receivableRemaining);
  const totalPayable = Money.fromDbCents(aggregate.payableRemaining);

  return {
    totalReceivable: totalReceivable.toOutputYuan(),
    totalPayable: totalPayable.toOutputYuan(),
    netReceivable: totalReceivable.subtract(totalPayable).toOutputYuan(),
    overdueCount: aggregate.overdueCount,
    newThisMonth: aggregate.newThisMonthCount,
  };
}
