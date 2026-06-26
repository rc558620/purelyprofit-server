import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toNullableText } from './employees.utils';

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
  month: Date;
  baseSalary: number;
  leaveDeduction: number;
  otherDeduction: number;
  bonus: number;
  actualSalary: number;
  socialInsurance: number;
  housingFund: number;
  totalLaborCost: number;
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
): Prisma.DateTimeFilter | Date | undefined {
  if (!year) {
    return undefined;
  }

  if (!month || month === 0) {
    // 过滤整年：从 year-01-01 到 year-12-31（下一年元旦前）
    return {
      gte: new Date(`${year}-01-01T00:00:00.000Z`),
      lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
    };
  }

  // 过滤特定月份：从 year-month-01 到 year-month-01 下一月
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    gte: new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`),
    lt: new Date(
      `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`,
    ),
  };
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
  // 数据库存储的是 cents，需要转换为 yuan
  const totalActualSalary = rows.reduce(
    (sum, row) => sum + centsToYuan(row.actualSalary),
    0,
  );
  const totalLaborCost = rows.reduce(
    (sum, row) => sum + centsToYuan(row.totalLaborCost),
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
      month: formatPayrollMonth(row.month),
      baseSalary: centsToYuan(row.baseSalary),
      leaveDeduction: centsToYuan(row.leaveDeduction),
      otherDeduction: centsToYuan(row.otherDeduction),
      bonus: centsToYuan(row.bonus),
      actualSalary: centsToYuan(row.actualSalary),
      ...(row.socialInsurance > 0
        ? { socialInsurance: centsToYuan(row.socialInsurance) }
        : {}),
      ...(row.housingFund > 0
        ? { housingFund: centsToYuan(row.housingFund) }
        : {}),
      totalLaborCost: centsToYuan(row.totalLaborCost),
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.getTime() } : {}),
    })),
  };
}

/**
 * 将分转换为元
 */
function centsToYuan(cents: number): number {
  return Math.round(cents) / 100;
}
