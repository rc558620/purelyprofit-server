import { Injectable } from '@nestjs/common';
import { HandoverStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildShiftDateRange, type ShiftRecordRow } from './handover.shared';
import type { ConfirmShiftLookupOptions } from './handover-confirm-shift.service';

/**
 * 班次回溯兜底逻辑：基于各班次自身 shift.date 计算时段，筛选已过期且未交班的班次，
 * 取最早的一条。用于历史未交班次回溯场景，避免 pickShiftRecord 以 handoverAt 为基准
 * 导致的语义错误。
 */
@Injectable()
export class HandoverConfirmShiftFallbackService {
  constructor(private readonly prisma: PrismaService) {}

  async findEarliestUnhandedShift(
    storeId: number,
    shifts: ShiftRecordRow[],
    options: ConfirmShiftLookupOptions,
  ): Promise<ShiftRecordRow | null> {
    const now = options.handoverAt;
    // 仅保留已过期的班次（班次结束时间 < 当前时间）
    const overdueShifts = shifts.filter((shift) => {
      const range = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date,
      );
      return range.endAt.getTime() < now.getTime();
    });

    const candidates = overdueShifts.length > 0 ? overdueShifts : shifts;

    // 批量检查哪些班次已交班
    const allRanges = candidates.map((s) =>
      buildShiftDateRange(s.startTime, s.endTime, s.date),
    );
    const earliestStart = allRanges.reduce(
      (min, r) => (r.startAt < min ? r.startAt : min),
      allRanges[0]?.startAt ?? now,
    );
    const latestEnd = allRanges.reduce(
      (max, r) => (r.endAt > max ? r.endAt : max),
      allRanges[0]?.endAt ?? now,
    );
    const completedRecords = await this.prisma.storeHandoverRecord.findMany({
      where: {
        storeId,
        status: HandoverStatus.completed,
        OR: [
          ...(candidates.filter((s) => s.id != null).length > 0
            ? [
                {
                  employeeShiftIdSnapshot: {
                    in: candidates
                      .filter((s) => s.id != null)
                      .map((s) => s.id as number),
                  },
                },
              ]
            : []),
          {
            employeeShiftIdSnapshot: null,
            handoverAt: { gte: earliestStart, lte: latestEnd },
          },
        ],
      },
      select: {
        employeeShiftIdSnapshot: true,
        handoverAt: true,
      },
    });

    const handedOverIds = new Set(
      completedRecords
        .filter((r) => r.employeeShiftIdSnapshot !== null)
        .map((r) => r.employeeShiftIdSnapshot as number),
    );
    const handedOverTimes = completedRecords
      .filter((r) => r.employeeShiftIdSnapshot === null && r.handoverAt)
      .map((r) => r.handoverAt!.getTime());

    // 取第一个未交班的候选班次（已按 date asc, startTime asc 排序）
    for (const shift of candidates) {
      if (shift.id && handedOverIds.has(shift.id)) continue;
      const range = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date,
      );
      const isHandedOver = handedOverTimes.some(
        (t) => t >= range.startAt.getTime() && t <= range.endAt.getTime(),
      );
      if (!isHandedOver) {
        return shift;
      }
    }

    return candidates[0] ?? null;
  }
}
