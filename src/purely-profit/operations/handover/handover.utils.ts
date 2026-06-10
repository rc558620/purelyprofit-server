import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { ShiftDateRange } from './handover.types';

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

export const roundMoney = (value: number): number =>
  new Decimal(value).toDecimalPlaces(2).toNumber();

export const timeStringToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map((v) => parseInt(v, 10));
  return hours * 60 + (minutes || 0);
};

export const toMoneyNumber = (
  value: Prisma.Decimal | number | string | null | undefined,
): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  const d = new Decimal(value);
  if (!d.isFinite()) {
    return 0;
  }
  return d.toDecimalPlaces(2).toNumber();
};

/** Decimal 安全的金额乘法 */
export const mulMoney = (a: number, b: number): number =>
  new Decimal(a).mul(b).toDecimalPlaces(2).toNumber();

/** Decimal 安全的金额加法 */
export const addMoney = (a: number, b: number): number =>
  new Decimal(a).add(b).toDecimalPlaces(2).toNumber();

/** Decimal 安全的金额减法 */
export const subMoney = (a: number, b: number): number =>
  new Decimal(a).sub(b).toDecimalPlaces(2).toNumber();

/** Decimal 安全的金额除法（保留 2 位小数） */
export const divMoney = (a: number, b: number): number =>
  b === 0 ? 0 : new Decimal(a).div(b).toDecimalPlaces(2).toNumber();

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
  const startAt = new Date(now);
  startAt.setHours(0, 0, 0, 0);
  const endAt = new Date(now);
  endAt.setHours(23, 59, 59, 999);

  if (!TIME_TEXT_PATTERN.test(startTime) || !TIME_TEXT_PATTERN.test(endTime)) {
    return { startAt, endAt };
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
