import { BadRequestException } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';

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

export function resolveShiftTypeFromDefinition(input: {
  shiftName: string;
  startTime: string;
  endTime: string;
}): EmployeeShiftType {
  const normalizedName = input.shiftName.trim();
  const normalizedStartTime = input.startTime.trim();
  const normalizedEndTime = input.endTime.trim();
  const matchedByTime = LEGACY_SHIFT_TYPE_RULES.find(
    (rule) =>
      rule.startTime === normalizedStartTime &&
      rule.endTime === normalizedEndTime,
  );
  if (matchedByTime) {
    return matchedByTime.type;
  }

  const matchedByName = LEGACY_SHIFT_TYPE_RULES.find((rule) =>
    rule.names.includes(normalizedName),
  );
  if (
    matchedByName &&
    matchedByName.startTime === normalizedStartTime &&
    matchedByName.endTime === normalizedEndTime
  ) {
    return matchedByName.type;
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
