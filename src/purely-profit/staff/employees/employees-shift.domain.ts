import { BadRequestException } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import {
  addShanghaiDays,
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
  getShanghaiWeekday,
  isSameShanghaiDay,
} from '../../../shared/shanghai-time.utils';

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
  const dayStart = getShanghaiDayStartMs(date);
  return {
    gte: new Date(dayStart),
    lt: new Date(addShanghaiDays(dayStart, 1)),
  };
}

export function assertShiftBusinessRules(
  startTime: string,
  endTime: string,
): void {
  const startMinutes = parseTimeToMinutes(startTime, '上班时间格式不正确');
  const endMinutes = parseTimeToMinutes(endTime, '下班时间格式不正确');

  // #11 修复：允许跨日排班（如 22:00-06:00），只检查时间格式有效即可
  // 同日排班要求 start < end，跨日排班 start >= end 是合法的
  if (startMinutes === endMinutes) {
    throw new BadRequestException('排班上班时间和下班时间不能相同');
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
  // #11 修复：支持跨日排班（如 22:00-06:00）
  // 如果 end <= start，表示跨日，将 end 加 24h 来处理
  const effectiveEnd =
    endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
  const effectiveCompareEnd =
    compareEndMinutes <= compareStartMinutes
      ? compareEndMinutes + 1440
      : compareEndMinutes;

  return (
    startMinutes < effectiveCompareEnd && compareStartMinutes < effectiveEnd
  );
}

/** 判断两个 Date 是否为同一自然日（按上海时区切分） */
export function isSameCalendarDay(left: Date, right: Date): boolean {
  return isSameShanghaiDay(left.getTime(), right.getTime());
}

/**
 * 将「日期 + 时分字符串」解析为绝对时间区间。
 * 跨日班次（end <= start，如 22:00-06:00）会自动把结束时间 +1 天，
 * 因此返回的时间区间可在不同自然日之间正确比较是否重叠。
 */
export function buildShiftAbsoluteRange(
  date: Date,
  startTime: string,
  endTime: string,
): { startAt: Date; endAt: Date } {
  const startMinutes = parseTimeToMinutes(startTime, '上班时间格式不正确');
  const endMinutes = parseTimeToMinutes(endTime, '下班时间格式不正确');
  // 班次时刻按上海墙钟解释，跨天班次自动顺延一天
  const baseMs = getShanghaiDayStartMs(date.getTime());
  const startAtMs = baseMs + startMinutes * 60_000;
  let endAtMs = baseMs + endMinutes * 60_000;
  if (endAtMs <= startAtMs) {
    endAtMs = addShanghaiDays(baseMs, 1) + endMinutes * 60_000;
  }
  return { startAt: new Date(startAtMs), endAt: new Date(endAtMs) };
}

/** 基于绝对时间区间判断两个班次是否重叠（正确支持跨日班次） */
export function isAbsoluteRangeOverlapping(
  left: { startAt: Date; endAt: Date },
  right: { startAt: Date; endAt: Date },
): boolean {
  return (
    left.startAt.getTime() < right.endAt.getTime() &&
    right.startAt.getTime() < left.endAt.getTime()
  );
}

/**
 * 构建覆盖「前一日 / 当日 / 后一日」的日期查询范围，
 * 用于跨日排班重叠检测：前一日跨日班次的尾段与当日班次、
 * 当日跨日班次与后一日班次均可能发生时间交叉。
 */
export function buildThreeDayDateRange(date: number): {
  gte: Date;
  lt: Date;
} {
  // 覆盖前后各一天，兼容跨天班次（上海时区）
  const dayStart = getShanghaiDayStartMs(date);
  const start = new Date(addShanghaiDays(dayStart, -1));
  const endExclusive = new Date(addShanghaiDays(dayStart, 2));
  return { gte: start, lt: endExclusive };
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
  const ms = date.getTime();
  return `${formatShanghaiDayLabel(ms)} 周${weeks[getShanghaiWeekday(ms)]}`;
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
