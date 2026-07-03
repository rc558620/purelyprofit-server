import { Injectable } from '@nestjs/common';
import { HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildShiftDateRange, type ShiftRecordRow } from './handover.shared';

/** 已交班班次的标识集合（精确 ID + 时间范围兜底） */
export type HandedOverShiftIds = {
  byShiftId: Set<number>;
  byRange: Array<{
    employeeId: number;
    startAt: Date;
    endAt: Date;
    createdAt: Date | null;
  }>;
};

@Injectable()
export class HandoverShiftHandoverStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查单个班次是否已完成交班。
   * 匹配规则：
   * - 优先：employeeShiftIdSnapshot 精确匹配 shift.id
   * - 兜底：employeeShiftIdSnapshot IS NULL + handoverAt 在 shift 时间段内
   */
  async isShiftHandedOver(
    storeId: number,
    shiftRecord: ShiftRecordRow | null,
  ): Promise<boolean> {
    if (!shiftRecord?.employeeId) {
      return false;
    }

    const shiftRange = buildShiftDateRange(
      shiftRecord.startTime,
      shiftRecord.endTime,
      shiftRecord.date,
    );
    const shiftMatchConditions: Prisma.StoreHandoverRecordWhereInput[] = [
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
      } as Prisma.StoreHandoverRecordWhereInput,
    ];
    if (shiftRecord.id) {
      shiftMatchConditions.unshift({
        employeeShiftIdSnapshot: shiftRecord.id,
        ...(shiftRecord.createdAt
          ? {
              createdAt: {
                gte: shiftRecord.createdAt,
              },
            }
          : {}),
      } as Prisma.StoreHandoverRecordWhereInput);
    }

    const count = await this.prisma.storeHandoverRecord.count({
      where: {
        storeId,
        fromEmployeeId: shiftRecord.employeeId,
        status: HandoverStatus.completed,
        OR: shiftMatchConditions,
      },
    });
    return count > 0;
  }

  /**
   * 为班次列表批量附加交班完成状态。
   * 调用方提供已加载的班次列表，本方法批量查询交班记录并逐条匹配。
   */
  async attachCompletionStatus(
    storeId: number,
    shifts: ShiftRecordRow[],
  ): Promise<Array<{ shift: ShiftRecordRow; handedOver: boolean }>> {
    if (shifts.length === 0) {
      return [];
    }

    const handedOverShiftIds = await this.loadHandedOverShiftIds(
      storeId,
      shifts,
    );

    return shifts.map((shift) => ({
      shift,
      handedOver: this.isShiftHandedOverFromSet(shift, handedOverShiftIds),
    }));
  }

  /**
   * 一次性加载所有已交班的 shift 标识集合，供内存匹配。
   *
   * 匹配规则与 isShiftHandedOver 保持一致：
   * - 优先：employeeShiftIdSnapshot 精确匹配 shift.id
   * - 兜底：employeeShiftIdSnapshot IS NULL + handoverAt 在 shift 时间段内
   */
  private async loadHandedOverShiftIds(
    storeId: number,
    shifts: ShiftRecordRow[],
  ): Promise<HandedOverShiftIds> {
    const shiftIds = shifts.map((s) => s.id).filter((id): id is number => !!id);

    // 计算所有 shift 时间段的整体范围，用于缩小查询范围
    const allRanges = shifts.map((s) =>
      buildShiftDateRange(s.startTime, s.endTime, s.date),
    );
    const earliestStart = allRanges.reduce(
      (min, r) => (r.startAt < min ? r.startAt : min),
      allRanges[0]?.startAt ?? new Date(0),
    );
    const latestEnd = allRanges.reduce(
      (max, r) => (r.endAt > max ? r.endAt : max),
      allRanges[0]?.endAt ?? new Date(),
    );

    const handoverRecords = await this.prisma.storeHandoverRecord.findMany({
      where: {
        storeId,
        status: HandoverStatus.completed,
        OR: [
          // 精确匹配：有 shift id 快照
          ...(shiftIds.length > 0
            ? [
                {
                  employeeShiftIdSnapshot: { in: shiftIds },
                },
              ]
            : []),
          // 兜底匹配：无 shift id 快照，handoverAt 在时间窗口内
          {
            employeeShiftIdSnapshot: null,
            handoverAt: { gte: earliestStart, lte: latestEnd },
          },
        ],
      },
      select: {
        employeeShiftIdSnapshot: true,
        fromEmployeeId: true,
        handoverAt: true,
        createdAt: true,
      },
    });

    const byShiftId = new Set<number>();
    const byRange: HandedOverShiftIds['byRange'] = [];

    for (const record of handoverRecords) {
      if (record.employeeShiftIdSnapshot !== null) {
        byShiftId.add(record.employeeShiftIdSnapshot);
      } else if (record.fromEmployeeId !== null && record.handoverAt !== null) {
        // 兜底记录：记录 handoverAt 所在的 1ms 点作为范围（实际在 isShiftHandedOverFromSet 里按 shift 范围匹配）
        byRange.push({
          employeeId: record.fromEmployeeId,
          startAt: record.handoverAt,
          endAt: record.handoverAt,
          createdAt: record.createdAt,
        });
      }
    }

    return { byShiftId, byRange };
  }

  private isShiftHandedOverFromSet(
    shift: ShiftRecordRow,
    handedOverShiftIds: HandedOverShiftIds,
  ): boolean {
    if (!shift.employeeId) {
      return false;
    }

    // 精确匹配 shift id 快照
    if (shift.id && handedOverShiftIds.byShiftId.has(shift.id)) {
      return true;
    }

    // 兜底：检查是否有 handoverAt 落在该 shift 时间段内的记录
    const shiftRange = buildShiftDateRange(
      shift.startTime,
      shift.endTime,
      shift.date,
    );
    return handedOverShiftIds.byRange.some((record) => {
      if (record.employeeId !== shift.employeeId) {
        return false;
      }
      if (
        shift.createdAt &&
        record.createdAt &&
        record.createdAt < shift.createdAt
      ) {
        return false;
      }
      return (
        record.startAt >= shiftRange.startAt &&
        record.startAt <= shiftRange.endAt
      );
    });
  }
}
