import { buildShiftDateRange, startOfDay, endOfDay } from './handover.shared';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { HandoverRecordRow, RecordShiftSnapshot } from './handover.shared';

/**
 * 构建交班记录班次匹配的 7 天兜底时间窗口。
 *
 * 当 record 没有快照字段或快照关联的 shift 已被删除/跨店时，
 * 回退到以 referenceDate 为锚点、向前 7 天的窗口来搜索候选班次。
 */
export function buildFallbackDayRange(referenceDate: Date) {
  return {
    // 上海时区下向前推 7 天
    gte: new Date(
      addShanghaiDays(getShanghaiDayStartMs(referenceDate.getTime()), -7),
    ),
    lte: endOfDay(referenceDate),
  };
}

/**
 * 在候选班次中查找时间范围覆盖 referenceDate 的班次。
 * 可选按 shiftType 偏好筛选。
 */
export function findMatchingShift(
  shifts: RecordShiftSnapshot[],
  referenceDate: Date,
  shiftType?: HandoverRecordRow['shiftTypeSnapshot'],
): RecordShiftSnapshot | null {
  const isInTimeRange = (shift: RecordShiftSnapshot) => {
    const range = buildShiftDateRange(
      shift.startTime,
      shift.endTime,
      shift.date ?? referenceDate,
    );
    return (
      range.startAt.getTime() <= referenceDate.getTime() &&
      referenceDate.getTime() <= range.endAt.getTime()
    );
  };

  const matched = shifts.find(
    (shift) =>
      isInTimeRange(shift) && (!shiftType || shift.shiftType === shiftType),
  );
  return matched ?? null;
}

/**
 * 在候选班次中查找 referenceDate 之前已开始的最近班次。
 * 可选按 shiftType 偏好筛选。
 */
export function findLatestStartedShift(
  shifts: RecordShiftSnapshot[],
  referenceDate: Date,
  shiftType?: HandoverRecordRow['shiftTypeSnapshot'],
): RecordShiftSnapshot | null {
  const started = shifts
    .filter((shift) => {
      const range = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date ?? referenceDate,
      );
      return range.startAt.getTime() <= referenceDate.getTime();
    })
    .sort((left, right) => {
      const leftStartAt = buildShiftDateRange(
        left.startTime,
        left.endTime,
        left.date ?? referenceDate,
      ).startAt;
      const rightStartAt = buildShiftDateRange(
        right.startTime,
        right.endTime,
        right.date ?? referenceDate,
      ).startAt;
      return rightStartAt.getTime() - leftStartAt.getTime();
    });

  if (started.length === 0) return null;
  if (!shiftType) return started[0];
  return started.find((shift) => shift.shiftType === shiftType) ?? null;
}
