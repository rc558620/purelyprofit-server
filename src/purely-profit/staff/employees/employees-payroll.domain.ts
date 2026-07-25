import { BadRequestException } from '@nestjs/common';
import type { EmployeePayroll, Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { toNullableText } from './employees.utils';
import type { UpdateEmployeePayrollDto } from './dto/employee-payroll.dto';

export interface PayrollDraftInput {
  baseSalary: Money;
  leaveDeduction: Money;
  otherDeduction: Money;
  otherDeductionNote?: string | null;
  bonus: Money;
  socialInsurance?: Money;
  housingFund?: Money;
}

export interface PayrollDerivedAmounts {
  actualSalary: Money;
  totalLaborCost: Money;
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

// 数据库读出的 payroll 行，金额字段为分

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
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
    input.otherDeduction.isPositive() &&
    !toNullableText(input.otherDeductionNote ?? '')
  ) {
    throw new BadRequestException('存在其他扣款时必须填写扣款说明');
  }

  const actualSalary = input.baseSalary
    .subtract(input.leaveDeduction)
    .subtract(input.otherDeduction)
    .add(input.bonus);
  if (actualSalary.isNegative()) {
    throw new BadRequestException('实发工资不能小于 0，请检查扣款与奖金');
  }

  return {
    actualSalary,
    totalLaborCost: actualSalary
      .add(input.socialInsurance ?? Money.zero())
      .add(input.housingFund ?? Money.zero()),
  };
}

/**
 * 合并 DTO 部分更新与现有工资单金额，返回各字段的 Money 值。
 * 用于计算派生金额（actualSalary / totalLaborCost）。
 */
export function resolvePayrollMergedAmounts(
  dto: UpdateEmployeePayrollDto,
  payroll: EmployeePayroll,
) {
  return {
    baseSalary:
      dto.baseSalary !== undefined
        ? Money.fromInputYuan(dto.baseSalary)
        : Money.fromDbCents(payroll.baseSalary),
    leaveDeduction:
      dto.leaveDeduction !== undefined
        ? Money.fromInputYuan(dto.leaveDeduction)
        : Money.fromDbCents(payroll.leaveDeduction),
    otherDeduction:
      dto.otherDeduction !== undefined
        ? Money.fromInputYuan(dto.otherDeduction)
        : Money.fromDbCents(payroll.otherDeduction),
    otherDeductionNote:
      dto.otherDeductionNote !== undefined
        ? dto.otherDeductionNote
        : (payroll.otherDeductionNote ?? undefined),
    bonus:
      dto.bonus !== undefined
        ? Money.fromInputYuan(dto.bonus)
        : Money.fromDbCents(payroll.bonus),
    socialInsurance:
      dto.socialInsurance !== undefined
        ? Money.fromInputYuan(dto.socialInsurance)
        : Money.fromDbCents(payroll.socialInsurance),
    housingFund:
      dto.housingFund !== undefined
        ? Money.fromInputYuan(dto.housingFund)
        : Money.fromDbCents(payroll.housingFund),
  };
}

/**
 * 根据 DTO 部分字段构建 Prisma update data，仅包含 DTO 中实际传入的字段 + 派生金额。
 */
export function buildPayrollUpdateData(
  dto: UpdateEmployeePayrollDto,
  derived: PayrollDerivedAmounts,
): Prisma.EmployeePayrollUpdateInput {
  return {
    ...(dto.baseSalary !== undefined
      ? { baseSalary: Money.fromInputYuan(dto.baseSalary).toDbCents() }
      : {}),
    ...(dto.leaveDeduction !== undefined
      ? { leaveDeduction: Money.fromInputYuan(dto.leaveDeduction).toDbCents() }
      : {}),
    ...(dto.otherDeduction !== undefined
      ? {
          otherDeduction: Money.fromInputYuan(dto.otherDeduction).toDbCents(),
        }
      : {}),
    ...(dto.otherDeductionNote !== undefined
      ? { otherDeductionNote: toNullableText(dto.otherDeductionNote) }
      : {}),
    ...(dto.bonus !== undefined
      ? { bonus: Money.fromInputYuan(dto.bonus).toDbCents() }
      : {}),
    ...(dto.socialInsurance !== undefined
      ? {
          socialInsurance:
            dto.socialInsurance > 0
              ? Money.fromInputYuan(dto.socialInsurance).toDbCents()
              : 0,
        }
      : {}),
    ...(dto.housingFund !== undefined
      ? {
          housingFund:
            dto.housingFund > 0
              ? Money.fromInputYuan(dto.housingFund).toDbCents()
              : 0,
        }
      : {}),
    ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
    actualSalary: derived.actualSalary.toDbCents(),
    totalLaborCost: derived.totalLaborCost.toDbCents(),
  };
}

export function buildPayrollReport(
  rows: PayrollReportRowInput[],
): PayrollReportResult {
  const confirmedCount = rows.length;
  // 数据库存储的是 cents，用 Money.fromDbCents 读取后聚合
  const totalActualSalaryMoney = Money.sum(
    rows.map((row) => Money.fromDbCents(row.actualSalary)),
  );
  const totalLaborCost = Money.sum(
    rows.map((row) => Money.fromDbCents(row.totalLaborCost)),
  ).toOutputYuan();

  return {
    summary: {
      confirmedCount,
      totalActualSalary: totalActualSalaryMoney.toOutputYuan(),
      totalLaborCost,
      avgActualSalary:
        confirmedCount === 0
          ? 0
          : totalActualSalaryMoney.divide(confirmedCount).toOutputYuan(),
    },
    rows: rows.map((row) => ({
      id: String(row.id),
      employeeName: row.employeeName,
      month: formatPayrollMonth(row.month),
      baseSalary: Money.fromDbCents(row.baseSalary).toOutputYuan(),
      leaveDeduction: Money.fromDbCents(row.leaveDeduction).toOutputYuan(),
      otherDeduction: Money.fromDbCents(row.otherDeduction).toOutputYuan(),
      bonus: Money.fromDbCents(row.bonus).toOutputYuan(),
      actualSalary: Money.fromDbCents(row.actualSalary).toOutputYuan(),
      ...(row.socialInsurance > 0
        ? {
            socialInsurance: Money.fromDbCents(
              row.socialInsurance,
            ).toOutputYuan(),
          }
        : {}),
      ...(row.housingFund > 0
        ? {
            housingFund: Money.fromDbCents(row.housingFund).toOutputYuan(),
          }
        : {}),
      totalLaborCost: Money.fromDbCents(row.totalLaborCost).toOutputYuan(),
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.getTime() } : {}),
    })),
  };
}
