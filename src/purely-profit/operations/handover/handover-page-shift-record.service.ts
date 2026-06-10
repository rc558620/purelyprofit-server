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

    return Promise.all(
      allShifts.map(async (shift) => ({
        shift,
        handedOver: await this.isShiftHandedOver(storeId, shift),
      })),
    );
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
