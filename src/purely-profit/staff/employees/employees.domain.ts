import { BadRequestException } from '@nestjs/common';
import { EmployeeShiftType, EmployeeStatus, type Prisma } from '@prisma/client';
import { toDecimalNumber, toNullableText } from './employees.utils';

type DecimalLike = {
  toString(): string;
};

export interface EmployeeListQueryInput {
  status?: EmployeeStatus;
  department?: string;
  keyword?: string;
}

export interface EmployeeOverviewMetricsInput {
  activeCount: number;
  resignedCount: number;
  leaveRows: Array<{ days: DecimalLike }>;
  pendingPayrollCount: number;
  resignedThisMonth: number;
}

export interface EmployeesOverviewSummary {
  activeCount: number;
  resignedCount: number;
  leaveDaysThisMonth: number;
  pendingPayrollCount: number;
  resignedThisMonth: number;
}

export interface LeaveBusinessRuleInput {
  startDate: number;
  endDate: number;
  days: number;
  deductSalary: boolean;
  deductAmount: number;
}

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

export interface ShiftReportRowInput {
  id: number;
  date: Date;
  employeeId: number;
  employeeName: string;
  shiftDefinitionId: number | null;
  shiftName: string;
  startTime: string;
  endTime: string;
}

export interface ShiftReportResult {
  summary: {
    totalShifts: number;
    employeeCount: number;
    definitionCounts: Array<{
      shiftDefinitionId?: string;
      shiftName: string;
      count: number;
    }>;
  };
  rows: Array<{
    id: string;
    dateLabel: string;
    employeeName: string;
    shiftDefinitionId?: string;
    shiftName: string;
    startTime: string;
    endTime: string;
  }>;
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

export function buildEmployeeListWhere(
  storeId: number,
  query: EmployeeListQueryInput,
): Prisma.EmployeeWhereInput {
  return {
    storeId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.department
      ? { department: { equals: query.department, mode: 'insensitive' } }
      : {}),
    ...(query.keyword
      ? {
          OR: [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { empNo: { contains: query.keyword, mode: 'insensitive' } },
            { phone: { contains: query.keyword } },
            { position: { contains: query.keyword, mode: 'insensitive' } },
            { department: { contains: query.keyword, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export function buildEmployeeListOrderBy(
  status?: EmployeeStatus,
): Prisma.EmployeeOrderByWithRelationInput[] {
  return status
    ? [{ createdAt: 'desc' }, { id: 'desc' }]
    : [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }];
}

export function buildEmployeesOverviewResponse(
  metrics: EmployeeOverviewMetricsInput,
): EmployeesOverviewSummary {
  return {
    activeCount: metrics.activeCount,
    resignedCount: metrics.resignedCount,
    leaveDaysThisMonth: metrics.leaveRows.reduce(
      (sum, item) => sum + toDecimalNumber(item.days),
      0,
    ),
    pendingPayrollCount: metrics.pendingPayrollCount,
    resignedThisMonth: metrics.resignedThisMonth,
  };
}

export function assertLeaveBusinessRules(input: LeaveBusinessRuleInput): void {
  if (input.startDate > input.endDate) {
    throw new BadRequestException('请假开始时间不能晚于结束时间');
  }
  if (input.days <= 0) {
    throw new BadRequestException('请假天数必须大于 0');
  }
  if (!input.deductSalary && input.deductAmount > 0) {
    throw new BadRequestException('未扣薪的请假记录扣款金额必须为 0');
  }
}

export function buildSingleDayDateRange(date: number): { gte: Date; lt: Date } {
  const currentDate = new Date(date);
  return {
    gte: new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
      0,
      0,
      0,
      0,
    ),
    lt: new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + 1,
      0,
      0,
      0,
      0,
    ),
  };
}

export function assertShiftBusinessRules(
  startTime: string,
  endTime: string,
): void {
  const startMinutes = parseTimeToMinutes(startTime, '上班时间格式不正确');
  const endMinutes = parseTimeToMinutes(endTime, '下班时间格式不正确');

  if (startMinutes >= endMinutes) {
    throw new BadRequestException('排班上班时间必须早于下班时间');
  }
}

export function parseTimeToMinutes(value: string, message: string): number {
  const matched = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!matched) {
    throw new BadRequestException(message);
  }

  return Number(matched[1]) * 60 + Number(matched[2]);
}

export function isTimeRangeOverlapping(
  startMinutes: number,
  endMinutes: number,
  compareStartMinutes: number,
  compareEndMinutes: number,
): boolean {
  return startMinutes < compareEndMinutes && compareStartMinutes < endMinutes;
}

const LEGACY_SHIFT_TYPE_RULES: Array<{
  type: EmployeeShiftType;
  names: string[];
  startTime: string;
  endTime: string;
}> = [
  {
    type: EmployeeShiftType.morning,
    names: ['早班'],
    startTime: '08:00',
    endTime: '14:00',
  },
  {
    type: EmployeeShiftType.nine_to_six,
    names: ['行政班'],
    startTime: '09:00',
    endTime: '18:00',
  },
  {
    type: EmployeeShiftType.middle,
    names: ['中班'],
    startTime: '12:00',
    endTime: '18:00',
  },
  {
    type: EmployeeShiftType.late,
    names: ['晚班'],
    startTime: '17:00',
    endTime: '23:00',
  },
  {
    type: EmployeeShiftType.full,
    names: ['全天'],
    startTime: '09:00',
    endTime: '21:00',
  },
];

export function resolveShiftTypeFromDefinition(input: {
  shiftName: string;
  startTime: string;
  endTime: string;
}): EmployeeShiftType {
  const normalizedName = input.shiftName.trim();
  const matchedByName = LEGACY_SHIFT_TYPE_RULES.find((rule) =>
    rule.names.includes(normalizedName),
  );
  if (matchedByName) {
    return matchedByName.type;
  }

  const matchedByTime = LEGACY_SHIFT_TYPE_RULES.find(
    (rule) =>
      rule.startTime === input.startTime.trim() &&
      rule.endTime === input.endTime.trim(),
  );
  if (matchedByTime) {
    return matchedByTime.type;
  }

  return EmployeeShiftType.custom;
}

export function formatShiftReportDate(date: Date): string {
  const weeks = ['日', '一', '二', '三', '四', '五', '六'];
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day} 周${weeks[date.getDay()]}`;
}

export function buildShiftReport(
  rows: ShiftReportRowInput[],
): ShiftReportResult {
  const employeeIds = new Set<number>();
  const definitionCountMap = new Map<
    string,
    { shiftDefinitionId?: string; shiftName: string; count: number }
  >();

  for (const row of rows) {
    employeeIds.add(row.employeeId);
    const key = `${row.shiftDefinitionId ?? 'legacy'}:${row.shiftName}`;
    const current = definitionCountMap.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    definitionCountMap.set(key, {
      ...(row.shiftDefinitionId !== null
        ? { shiftDefinitionId: String(row.shiftDefinitionId) }
        : {}),
      shiftName: row.shiftName,
      count: 1,
    });
  }

  return {
    summary: {
      totalShifts: rows.length,
      employeeCount: employeeIds.size,
      definitionCounts: Array.from(definitionCountMap.values()).sort(
        (left, right) =>
          right.count - left.count ||
          left.shiftName.localeCompare(right.shiftName),
      ),
    },
    rows: rows.map((row) => ({
      id: String(row.id),
      dateLabel: formatShiftReportDate(row.date),
      employeeName: row.employeeName,
      ...(row.shiftDefinitionId !== null
        ? { shiftDefinitionId: String(row.shiftDefinitionId) }
        : {}),
      shiftName: row.shiftName,
      startTime: row.startTime,
      endTime: row.endTime,
    })),
  };
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
