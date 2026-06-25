import { Injectable } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildShiftDateRange,
  endOfDay,
  type ShiftRecordRow,
} from './handover.shared';

@Injectable()
export class HandoverPageShiftRecordService {
  constructor(private readonly prisma: PrismaService) {}

  async findShiftRecord(
    storeId: number,
    employeeId: number | null,
    shiftType: EmployeeShiftType,
    allowEmployeeFallback = true,
  ): Promise<ShiftRecordRow | null> {
    const lookupRange = this.buildShiftLookupRange();
    const scopedShift = await this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        shiftType,
        date: lookupRange,
      },
      select: this.shiftRecordSelect,
      orderBy: employeeId
        ? [{ date: 'desc' }, { startTime: 'desc' }, { id: 'desc' }]
        : [{ date: 'desc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
    if (scopedShift || employeeId === null || !allowEmployeeFallback) {
      return scopedShift;
    }

    return this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        employeeId,
        date: lookupRange,
      },
      select: this.shiftRecordSelect,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { id: 'desc' }],
    });
  }

  async findEmployeeIdByOperatorName(
    storeId: number,
    operatorName: string,
  ): Promise<number | null> {
    const shift = await this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        employeeName: operatorName,
        date: this.buildShiftLookupRange(),
      },
      select: {
        employeeId: true,
      },
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { id: 'desc' }],
    });

    return shift?.employeeId ?? null;
  }

  async findCurrentShiftRecord(
    storeId: number,
    employeeId: number | null,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const shiftsWithCompletion = await this.loadShiftsWithCompletion(
      storeId,
      employeeId,
      referenceDate,
    );
    if (shiftsWithCompletion.length === 0) {
      return null;
    }

    return this.pickCurrentShiftRecord(shiftsWithCompletion, referenceDate);
  }

  async findStartedUnhandedShiftRecord(
    storeId: number,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const shiftsWithCompletion = await this.loadShiftsWithCompletion(
      storeId,
      null,
      referenceDate,
    );
    if (shiftsWithCompletion.length === 0) {
      return null;
    }

    return this.pickStartedUnhandedShiftRecord(
      shiftsWithCompletion,
      referenceDate,
    );
  }

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

  async findNextShiftRecord(
    storeId: number,
    currentShiftRecord: ShiftRecordRow | null,
    employeeId?: number | null,
  ): Promise<ShiftRecordRow | null> {
    if (!currentShiftRecord) {
      return null;
    }

    const allShifts = await this.loadShifts(
      storeId,
      employeeId ?? null,
      currentShiftRecord.date,
    );
    if (allShifts.length === 0) {
      return null;
    }

    const currentShiftIndex = allShifts.findIndex((shift) =>
      this.isSameShiftRecord(shift, currentShiftRecord),
    );
    if (currentShiftIndex < 0) {
      return null;
    }

    return allShifts[currentShiftIndex + 1] ?? null;
  }

  /**
   * 查找今日最后一个班次（不区分是否已交班）。
   * employeeId 为具体员工 ID 时只查该员工；为 null 时查全店。
   */
  async findLastShiftRecord(
    storeId: number,
    employeeId: number | null,
  ): Promise<ShiftRecordRow | null> {
    const allShifts = await this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: this.buildShiftLookupRange(),
      },
      select: this.shiftRecordSelect,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { id: 'desc' }],
      take: 1,
    });
    return allShifts[0] ?? null;
  }

  private pickCurrentShiftRecord(
    shiftsWithCompletion: Array<{
      shift: ShiftRecordRow;
      handedOver: boolean;
    }>,
    referenceDate: Date,
  ): ShiftRecordRow | null {
    const startedUnhandedShift = this.pickStartedUnhandedShiftRecord(
      shiftsWithCompletion,
      referenceDate,
    );
    if (startedUnhandedShift) {
      return startedUnhandedShift;
    }

    const now = new Date(referenceDate);
    const upcomingUnhandedShift = shiftsWithCompletion.find(
      ({ shift, handedOver }) =>
        !handedOver && this.getShiftStartAt(shift) > now,
    );
    if (upcomingUnhandedShift) {
      return upcomingUnhandedShift.shift;
    }

    return (
      shiftsWithCompletion.find(({ handedOver }) => !handedOver)?.shift ?? null
    );
  }

  private pickStartedUnhandedShiftRecord(
    shiftsWithCompletion: Array<{
      shift: ShiftRecordRow;
      handedOver: boolean;
    }>,
    referenceDate: Date,
  ): ShiftRecordRow | null {
    const now = new Date(referenceDate);
    const startedUnhandedShifts = shiftsWithCompletion.filter(
      ({ shift, handedOver }) =>
        !handedOver && this.getShiftStartAt(shift) <= now,
    );
    if (startedUnhandedShifts.length === 0) {
      return null;
    }

    const overdueUnhandedShifts = startedUnhandedShifts
      .filter(({ shift }) => this.getShiftEndAt(shift) < now)
      .sort(
        (left, right) =>
          this.getShiftStartAt(left.shift).getTime() -
          this.getShiftStartAt(right.shift).getTime(),
      );
    if (overdueUnhandedShifts.length > 0) {
      return overdueUnhandedShifts[0]?.shift ?? null;
    }

    const activeUnhandedShifts = startedUnhandedShifts.sort(
      (left, right) =>
        this.getShiftStartAt(right.shift).getTime() -
        this.getShiftStartAt(left.shift).getTime(),
    );

    return activeUnhandedShifts[0]?.shift ?? null;
  }

  private async loadShiftsWithCompletion(
    storeId: number,
    employeeId: number | null,
    referenceDate: Date,
  ): Promise<
    Array<{
      shift: ShiftRecordRow;
      handedOver: boolean;
    }>
  > {
    const allShifts = await this.loadShifts(storeId, employeeId, referenceDate);
    if (allShifts.length === 0) {
      return [];
    }

    // 批量查询已完成交班记录，避免逐个 shift 触发 N 次 count 查询
    const handedOverShiftIds = await this.loadHandedOverShiftIds(
      storeId,
      allShifts,
    );

    return allShifts.map((shift) => ({
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
  ): Promise<{
    byShiftId: Set<number>;
    byRange: Array<{
      employeeId: number;
      startAt: Date;
      endAt: Date;
      createdAt: Date | null;
    }>;
  }> {
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
    const byRange: Array<{
      employeeId: number;
      startAt: Date;
      endAt: Date;
      createdAt: Date | null;
    }> = [];

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
    handedOverShiftIds: {
      byShiftId: Set<number>;
      byRange: Array<{
        employeeId: number;
        startAt: Date;
        endAt: Date;
        createdAt: Date | null;
      }>;
    },
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

  private async loadShifts(
    storeId: number,
    employeeId: number | null,
    referenceDate: Date,
  ): Promise<ShiftRecordRow[]> {
    return this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: this.buildShiftLookupRange(referenceDate),
      },
      select: this.shiftRecordSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
  }

  private buildShiftLookupRange(baseDate = new Date()) {
    return {
      lte: endOfDay(baseDate),
    };
  }

  private getShiftStartAt(shift: ShiftRecordRow): Date {
    return buildShiftDateRange(shift.startTime, shift.endTime, shift.date)
      .startAt;
  }

  private getShiftEndAt(shift: ShiftRecordRow): Date {
    return buildShiftDateRange(shift.startTime, shift.endTime, shift.date)
      .endAt;
  }

  private isSameShiftRecord(
    left: ShiftRecordRow,
    right: ShiftRecordRow,
  ): boolean {
    return (
      left.employeeId === right.employeeId &&
      left.shiftType === right.shiftType &&
      left.date.getTime() === right.date.getTime() &&
      left.startTime === right.startTime &&
      left.endTime === right.endTime
    );
  }

  private readonly shiftRecordSelect = {
    id: true,
    employeeId: true,
    employeeName: true,
    shiftType: true,
    shiftName: true,
    date: true,
    startTime: true,
    endTime: true,
    createdAt: true,
  } as const;
}
