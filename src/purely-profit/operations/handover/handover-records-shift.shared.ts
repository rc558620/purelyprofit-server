// 交班记录 ↔ 班次的定位逻辑：按记录 createdAt 找到当时正在进行的班次
import type { Prisma } from '@prisma/client';
import type { ShiftRecordRow } from './handover.types';
import { buildShiftDateRange, buildShiftGraceEndAt } from './handover.shared';

/** 完成/取消交班记录时用于定位所属班次的回溯条数上限 */
export const OWNED_SHIFT_LOOKUP_TAKE = 30;

/**
 * 定位 pending 记录所属班次：以记录 createdAt 为时间基准，找到当时正在进行的班次。
 * 上界放宽到 endAt + 宽限，覆盖"班次结束后补建交班记录"的场景。
 */
export const findOwnedHandoverShift = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  employeeId: number,
  createdAt: Date,
): Promise<ShiftRecordRow | null> => {
  const employeeShifts = await tx.employeeShift.findMany({
    where: {
      storeId,
      employeeId,
      date: { lte: createdAt },
    },
    select: {
      id: true,
      employeeId: true,
      employeeName: true,
      shiftType: true,
      shiftName: true,
      startTime: true,
      endTime: true,
      date: true,
    },
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
    take: OWNED_SHIFT_LOOKUP_TAKE,
  });

  return (
    employeeShifts.find((shift) => {
      const range = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date,
      );
      return (
        createdAt.getTime() >= range.startAt.getTime() &&
        createdAt.getTime() <= buildShiftGraceEndAt(range).getTime()
      );
    }) ?? null
  );
};
