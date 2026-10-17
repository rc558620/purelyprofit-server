import { BadRequestException } from '@nestjs/common';
import { EmployeeShiftType, Prisma, StaffRole } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import {
  HANDOVER_SHIFT_GRACE_HOURS,
  SHIFT_TIME_FALLBACKS,
} from './handover.constants';

const DAY_MS = 86_400_000;
import type { ShiftDateRange, ShiftRecordRow } from './handover.types';

export const startOfDay = (date: Date): Date =>
  new Date(getShanghaiDayStartMs(date.getTime()));

export const endOfDay = (date: Date): Date =>
  new Date(getShanghaiDayStartMs(date.getTime()) + DAY_MS - 1);

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

/**
 * 解析操作员的真实角色：
 * 优先识别门店主账号（staff.userId === storeOwnerUserId → OWNER），
 * 其次使用 Staff.role（OWNER 直接可信），
 * 否则检查关联的 StoreSubAccount.role（manager → MANAGER）。
 */
export const resolveOperatorRole = (
  staff: {
    role: StaffRole;
    userId: number | null;
    employeeProfile: {
      subAccounts: { role: string } | null;
    } | null;
  } | null,
  storeOwnerUserId: number | null = null,
): StaffRole | null => {
  if (!staff) return null;
  // 操作员即门店主账号 → 主账号（store.ownerId 是权威依据，staff.role 历史数据可能未同步）
  if (storeOwnerUserId !== null && staff.userId === storeOwnerUserId) {
    return StaffRole.owner;
  }
  if (staff.role === StaffRole.owner) return StaffRole.owner;
  const subAccountRole = staff.employeeProfile?.subAccounts?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
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
  // 班次时刻文本按上海墙钟解释
  const dayStart = getShanghaiDayStartMs(baseDate.getTime());
  return new Date(
    dayStart + (Number(hourText) * 60 + Number(minuteText)) * 60_000,
  );
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
  let parsedEnd = createTimePoint(now, endTime);
  if (parsedEnd <= parsedStart) {
    // 跨天班次：结束时刻顺延到次日（上海时区）
    parsedEnd = new Date(addShanghaiDays(parsedEnd.getTime(), 1));
  }

  return {
    startAt: parsedStart,
    endAt: parsedEnd,
  };
};

/**
 * 把班次时段上界扩展宽限期，得到兜底匹配窗口的上界。
 *
 * 规则 5 要求 handoverAt 必须晚于班次结束时间，因此按 [startAt, endAt]
 * 匹配会漏掉所有合法交班记录。所有"无 employeeShiftIdSnapshot 兜底"场景
 * 都必须使用本方法计算上界，保证各链路窗口口径一致。
 */
export const buildShiftGraceEndAt = (
  shiftRange: ShiftDateRange,
  graceHours = HANDOVER_SHIFT_GRACE_HOURS,
): Date => new Date(shiftRange.endAt.getTime() + graceHours * 3_600_000);

/**
 * 判断两条班次记录是否为同一班次。
 *
 * 必须比较 date：EmployeeShift 有 (employeeId, date) 唯一约束，
 * 同一员工在不同日期可以有完全相同的班次时段；漏掉 date 会把其它日期的
 * 同时间段班次一起排除，导致"查找下一班"跳过真正的接班人班次。
 */
export const isSameShiftRecord = (
  left: ShiftRecordRow,
  right: ShiftRecordRow,
): boolean =>
  left.employeeId === right.employeeId &&
  left.shiftType === right.shiftType &&
  left.startTime === right.startTime &&
  left.endTime === right.endTime &&
  left.date?.getTime() === right.date?.getTime();

/**
 * 解析班次时刻文本，取第一个合法的 HH:mm。
 *
 * 自定义班次的 SHIFT_TIME_FALLBACKS 回落值是空串，若只用 ?? 兜底会把空串
 * 传进 buildShiftDateRange，得到 [now, now] 的零长窗口，
 * 使重复交班检测完全失效。这里保证最终结果一定是合法时刻。
 */
export const resolveShiftTimeText = (
  value: string | null | undefined,
  fallback: string,
): string => {
  const candidates = [
    value,
    fallback,
    SHIFT_TIME_FALLBACKS[EmployeeShiftType.morning].startTime,
  ];
  return (
    candidates.find(
      (text): text is string =>
        typeof text === 'string' && TIME_TEXT_PATTERN.test(text),
    ) ?? SHIFT_TIME_FALLBACKS[EmployeeShiftType.morning].startTime
  );
};

export const buildShiftMatchConditions = (
  shiftRecord: ShiftRecordRow,
  handoverAt: Date,
): Prisma.StoreHandoverRecordWhereInput[] => {
  const fallbackShiftType = shiftRecord.shiftType ?? EmployeeShiftType.morning;
  const fallbackTime = SHIFT_TIME_FALLBACKS[fallbackShiftType];
  const shiftRange = buildShiftDateRange(
    resolveShiftTimeText(shiftRecord.startTime, fallbackTime.startTime),
    resolveShiftTimeText(shiftRecord.endTime, fallbackTime.endTime),
    handoverAt,
  );
  const conditions: Prisma.StoreHandoverRecordWhereInput[] = [
    {
      employeeShiftIdSnapshot: null,
      handoverAt: {
        gte: shiftRange.startAt,
        // 上界含宽限期：合法交班的 handoverAt 恒 > endAt（规则 5）
        lte: buildShiftGraceEndAt(shiftRange),
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
