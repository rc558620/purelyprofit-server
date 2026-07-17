import { BadRequestException } from '@nestjs/common';
import { EmployeeShiftType, Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { SHIFT_TIME_FALLBACKS } from './handover.constants';
import type { ShiftDateRange, ShiftRecordRow } from './handover.types';

export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

export const endOfDay = (date: Date): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );

export const buildDayRange = (date: Date): Prisma.DateTimeFilter => ({
  gte: startOfDay(date),
  lte: endOfDay(date),
});

const TIME_TEXT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const normalizeRequiredText = (
  value: string,
  maxLength: number,
  emptyMessage: string,
): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new BadRequestException(emptyMessage);
  }
  return normalized.slice(0, maxLength);
};

export const normalizeOptionalText = (
  value: string | null | undefined,
  maxLength: number,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
};

export const toDisplayName = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

export const timeStringToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map((v) => parseInt(v, 10));
  return hours * 60 + (minutes || 0);
};

/** Prisma Decimal / DB 分金额 → 前端元金额（数字） */
export const dbCentsToOutputYuan = (
  value: Prisma.Decimal | number | string | null | undefined,
): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  const numValue = typeof value === 'number' ? value : Number(value);
  // Prisma 聚合结果可能产生非整数分，先四舍五入到整数再转换
  const centsValue = Math.round(numValue);
  return Money.fromDbCents(centsValue).toOutputYuan();
};

export const buildCurrentDayRange = (): Prisma.DateTimeFilter =>
  buildDayRange(new Date());

const createTimePoint = (baseDate: Date, timeText: string): Date => {
  const [, hourText, minuteText] = TIME_TEXT_PATTERN.exec(timeText) ?? [];
  const date = new Date(baseDate);
  date.setHours(Number(hourText), Number(minuteText), 0, 0);
  return date;
};

export const buildShiftDateRange = (
  startTime: string,
  endTime: string,
  baseDate = new Date(),
): ShiftDateRange => {
  const now = new Date(baseDate);

  if (!TIME_TEXT_PATTERN.test(startTime) || !TIME_TEXT_PATTERN.test(endTime)) {
    const fallbackPoint = new Date(now);
    fallbackPoint.setSeconds(0, 0);
    return {
      startAt: fallbackPoint,
      endAt: new Date(fallbackPoint),
    };
  }

  const parsedStart = createTimePoint(now, startTime);
  const parsedEnd = createTimePoint(now, endTime);
  if (parsedEnd <= parsedStart) {
    parsedEnd.setDate(parsedEnd.getDate() + 1);
  }

  return {
    startAt: parsedStart,
    endAt: parsedEnd,
  };
};

export const isSameShiftRecord = (
  left: ShiftRecordRow,
  right: ShiftRecordRow,
): boolean =>
  left.employeeId === right.employeeId &&
  left.shiftType === right.shiftType &&
  left.startTime === right.startTime &&
  left.endTime === right.endTime;

export const buildShiftMatchConditions = (
  shiftRecord: ShiftRecordRow,
  handoverAt: Date,
): Prisma.StoreHandoverRecordWhereInput[] => {
  const fallbackShiftType = shiftRecord.shiftType ?? EmployeeShiftType.morning;
  const fallbackTime = SHIFT_TIME_FALLBACKS[fallbackShiftType];
  const shiftRange = buildShiftDateRange(
    shiftRecord.startTime ?? fallbackTime.startTime,
    shiftRecord.endTime ?? fallbackTime.endTime,
    handoverAt,
  );
  const conditions: Prisma.StoreHandoverRecordWhereInput[] = [
    {
      employeeShiftIdSnapshot: null,
      handoverAt: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
      ...(shiftRecord.createdAt
        ? {
            createdAt: {
              gte: shiftRecord.createdAt,
            },
          }
        : {}),
    },
  ];
  if (shiftRecord.id) {
    conditions.unshift({
      employeeShiftIdSnapshot: shiftRecord.id,
    });
  }
  return conditions;
};

export const extendShiftRangeToReference = (
  shiftRange: ShiftDateRange,
  referenceDate = new Date(),
): ShiftDateRange => {
  const referenceTime = new Date(referenceDate);
  if (Number.isNaN(referenceTime.getTime())) {
    return shiftRange;
  }

  if (referenceTime <= shiftRange.endAt) {
    return shiftRange;
  }

  return {
    startAt: shiftRange.startAt,
    endAt: referenceTime,
  };
};
