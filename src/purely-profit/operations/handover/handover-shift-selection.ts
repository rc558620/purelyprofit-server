import { buildShiftDateRange, type ShiftRecordRow } from './handover.shared';

// 统一复用 handover.utils 的实现，避免两份语义不一致的班次比较逻辑
export { isSameShiftRecord } from './handover.shared';

type ShiftWithCompletion = {
  shift: ShiftRecordRow;
  handedOver: boolean;
};

/** 计算班次开始时间 */
export function getShiftStartAt(shift: ShiftRecordRow): Date {
  return buildShiftDateRange(shift.startTime, shift.endTime, shift.date)
    .startAt;
}

/** 计算班次结束时间 */
export function getShiftEndAt(shift: ShiftRecordRow): Date {
  return buildShiftDateRange(shift.startTime, shift.endTime, shift.date).endAt;
}

/**
 * 从已加载的班次列表中选择"当前班次"。
 *
 * 优先级：
 * 1. 已开始且未交班的班次（overdue 优先，否则按开始时间倒序取最新）
 * 2. 尚未开始的未交班班次
 * 3. 任意未交班班次
 */
export function pickCurrentShift(
  shiftsWithCompletion: ShiftWithCompletion[],
  referenceDate: Date,
): ShiftRecordRow | null {
  const startedUnhandedShift = pickStartedUnhandedShift(
    shiftsWithCompletion,
    referenceDate,
  );
  if (startedUnhandedShift) {
    return startedUnhandedShift;
  }

  const now = new Date(referenceDate);
  const upcomingUnhandedShift = shiftsWithCompletion.find(
    ({ shift, handedOver }) => !handedOver && getShiftStartAt(shift) > now,
  );
  if (upcomingUnhandedShift) {
    return upcomingUnhandedShift.shift;
  }

  return (
    shiftsWithCompletion.find(({ handedOver }) => !handedOver)?.shift ?? null
  );
}

/**
 * 从已加载的班次列表中选择"已开始但未交班"的班次。
 *
 * 优先级：
 * 1. 已过期（endAt < now）的未交班班次，按开始时间正序取最早的
 * 2. 当前进行中的未交班班次，按开始时间倒序取最新的
 */
export function pickStartedUnhandedShift(
  shiftsWithCompletion: ShiftWithCompletion[],
  referenceDate: Date,
): ShiftRecordRow | null {
  const now = new Date(referenceDate);
  const startedUnhandedShifts = shiftsWithCompletion.filter(
    ({ shift, handedOver }) => !handedOver && getShiftStartAt(shift) <= now,
  );
  if (startedUnhandedShifts.length === 0) {
    return null;
  }

  const overdueUnhandedShifts = startedUnhandedShifts
    .filter(({ shift }) => getShiftEndAt(shift) < now)
    .sort(
      (left, right) =>
        getShiftStartAt(left.shift).getTime() -
        getShiftStartAt(right.shift).getTime(),
    );
  if (overdueUnhandedShifts.length > 0) {
    return overdueUnhandedShifts[0]?.shift ?? null;
  }

  const activeUnhandedShifts = startedUnhandedShifts.sort(
    (left, right) =>
      getShiftStartAt(right.shift).getTime() -
      getShiftStartAt(left.shift).getTime(),
  );

  return activeUnhandedShifts[0]?.shift ?? null;
}
