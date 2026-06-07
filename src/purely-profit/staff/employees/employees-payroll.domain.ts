import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toDecimalNumber, toNullableText } from './employees.utils';

type DecimalLike = {
  toString(): string;
};

export interface PayrollDraftInput {
  baseSalary: number;
  leaveDeduction: number;
  otherDeduction: number;
  otherDeductionNote?: string | null;
  bonus: number;
  socialInsurance?: number;
  housingFund?: number;
}

export interface PayrollDerivedAmounts {
  actualSalary: number;
  totalLaborCost: number;
}

export interface PayrollReportRowInput {
  id: number;
  employeeName: string;
  month: string;
  baseSalary: number | DecimalLike;
  leaveDeduction: number | DecimalLike;
  otherDeduction: number | DecimalLike;
  bonus: number | DecimalLike;
  actualSalary: number | DecimalLike;
  socialInsurance: number | DecimalLike | null;
  housingFund: number | DecimalLike | null;
  totalLaborCost: number | DecimalLike;
  confirmedAt: Date | null;
}

export interface PayrollReportResult {
  summary: {
    confirmedCount: number;
    totalActualSalary: number;
    totalLaborCost: number;
    avgActualSalary: number;
  };
  rows: Array<{
    id: string;
    employeeName: string;
    month: string;
    baseSalary: number;
    leaveDeduction: number;
    otherDeduction: number;
    bonus: number;
    actualSalary: number;
    socialInsurance?: number;
    housingFund?: number;
    totalLaborCost: number;
    confirmedAt?: number;
  }>;
}

export function resolvePayrollMonthFilter(
  year?: number,
  month?: number,
): Prisma.StringFilter | string | undefined {
  if (!year) {
    return undefined;
  }

  if (!month || month === 0) {
    return {
      gte: `${year}-01`,
      lte: `${year}-12`,
    };
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatPayrollMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function assertPayrollMonthFormat(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException('结算月份必须是有效的 YYYY-MM 格式');
  }
}

export function buildPayrollDerivedAmounts(
  input: PayrollDraftInput,
): PayrollDerivedAmounts {
  if (
    input.otherDeduction > 0 &&
    !toNullableText(input.otherDeductionNote ?? '')
  ) {
    throw new BadRequestException('存在其他扣款时必须填写扣款说明');
  }

  const actualSalary =
    input.baseSalary -
    input.leaveDeduction -
    input.otherDeduction +
    input.bonus;
  if (actualSalary < 0) {
    throw new BadRequestException('实发工资不能小于 0，请检查扣款与奖金');
  }

  return {
    actualSalary,
    totalLaborCost:
      actualSalary + (input.socialInsurance ?? 0) + (input.housingFund ?? 0),
  };
}

export function buildPayrollReport(
  rows: PayrollReportRowInput[],
): PayrollReportResult {
  const confirmedCount = rows.length;
  const totalActualSalary = rows.reduce(
    (sum, row) => sum + toDecimalNumber(row.actualSalary),
    0,
  );
  const totalLaborCost = rows.reduce(
    (sum, row) => sum + toDecimalNumber(row.totalLaborCost),
    0,
  );

  return {
    summary: {
      confirmedCount,
      totalActualSalary,
      totalLaborCost,
      avgActualSalary:
        confirmedCount === 0 ? 0 : totalActualSalary / confirmedCount,
    },
    rows: rows.map((row) => ({
      id: String(row.id),
      employeeName: row.employeeName,
      month: row.month,
      baseSalary: toDecimalNumber(row.baseSalary),
      leaveDeduction: toDecimalNumber(row.leaveDeduction),
      otherDeduction: toDecimalNumber(row.otherDeduction),
      bonus: toDecimalNumber(row.bonus),
      actualSalary: toDecimalNumber(row.actualSalary),
      ...(row.socialInsurance !== null
        ? { socialInsurance: toDecimalNumber(row.socialInsurance) }
        : {}),
      ...(row.housingFund !== null
        ? { housingFund: toDecimalNumber(row.housingFund) }
        : {}),
      totalLaborCost: toDecimalNumber(row.totalLaborCost),
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.getTime() } : {}),
    })),
  };
}
