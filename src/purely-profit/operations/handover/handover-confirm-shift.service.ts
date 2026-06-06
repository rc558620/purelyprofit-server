import { ConflictException, Injectable } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  buildDayRange,
  timeStringToMinutes,
  toDisplayName,
  type ReceiverCandidate,
  type ShiftRecordRow,
} from './handover.shared';

export type ConfirmShiftLookupOptions = {
  shiftType: EmployeeShiftType;
  handoverAt: Date;
  shiftReferenceAt?: number;
  operatorName?: string;
};

const CONFIRM_SHIFT_RECORD_SELECT = {
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

@Injectable()
export class HandoverConfirmShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async findSourceShiftRecord(
    storeId: number,
    preferredEmployeeId: number | null,
    options: ConfirmShiftLookupOptions,
  ): Promise<ShiftRecordRow | null> {
    const shiftLookupDate = this.resolveShiftLookupDate(options);
    if (preferredEmployeeId) {
      const preferredShifts = await this.loadShiftCandidates(
        storeId,
        shiftLookupDate,
        preferredEmployeeId,
      );
      const matchedPreferredShift = this.pickShiftRecord(
        preferredShifts,
        options,
      );
      if (matchedPreferredShift) {
        return matchedPreferredShift;
      }
    }

    const storeShifts = await this.loadShiftCandidates(
      storeId,
      shiftLookupDate,
    );
    return this.pickShiftRecord(storeShifts, options);
  }

  async ensureShiftNotHandedOver(
    storeId: number,
    shiftRecord: ShiftRecordRow | null,
    handoverAt: Date,
  ): Promise<void> {
    let where: Prisma.StoreHandoverRecordWhereInput;

    if (shiftRecord?.employeeId) {
      // 子账号交班：检查同员工同班次是否已交班
      where = {
        storeId,
        fromEmployeeId: shiftRecord.employeeId,
        status: HandoverStatus.completed,
        OR: this.buildShiftMatchConditions(shiftRecord, handoverAt),
      };
    } else if (shiftRecord) {
      // 老板账号交班但有班次记录：按班次时间范围检查是否已交班
      const shiftRange = buildShiftDateRange(
        shiftRecord.startTime,
        shiftRecord.endTime,
        handoverAt,
      );
      where = {
        storeId,
        status: HandoverStatus.completed,
        handoverAt: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      };
    } else {
      // 老板账号交班且没有班次记录：不做检查（防御性编程）
      return;
    }

    const exists = await this.prisma.storeHandoverRecord.count({ where });
    if (exists > 0) {
      throw new ConflictException('当前班次已完成交班，暂不允许重复操作');
    }
  }

  async resolveReceiverCandidate(
    storeId: number,
    currentShiftRecord: ShiftRecordRow | null,
    handoverAt: Date,
  ): Promise<ReceiverCandidate | null> {
    const nextShiftRecord = await this.findNextShiftRecord(
      storeId,
      currentShiftRecord,
      currentShiftRecord?.date ?? handoverAt,
    );
    if (!nextShiftRecord?.employeeId) {
      return null;
    }

    const assignedSubAccount =
      await this.storeSubAccountService.findAssignedSubAccountByEmployee(
        storeId,
        nextShiftRecord.employeeId,
      );

    return {
      employeeId: nextShiftRecord.employeeId,
      employeeName: nextShiftRecord.employeeName,
      subAccountId: assignedSubAccount?.id ?? null,
      shiftDate: nextShiftRecord.date,
      shiftStartTime: nextShiftRecord.startTime,
      shiftEndTime: nextShiftRecord.endTime,
    };
  }

  private async findNextShiftRecord(
    storeId: number,
    currentShiftRecord: ShiftRecordRow | null,
    handoverAt: Date,
  ): Promise<ShiftRecordRow | null> {
    if (!currentShiftRecord) {
      return null;
    }

    const allShifts = await this.loadShiftCandidates(storeId, handoverAt);
    const currentStartMinutes = timeStringToMinutes(
      currentShiftRecord.startTime,
    );
    const currentEndMinutes = timeStringToMinutes(currentShiftRecord.endTime);

    const nextByEndTime = allShifts.find(
      (shift) =>
        !this.isSameShiftRecord(shift, currentShiftRecord) &&
        timeStringToMinutes(shift.startTime) >= currentEndMinutes,
    );
    if (nextByEndTime) {
      return nextByEndTime;
    }

    return (
      allShifts.find(
        (shift) =>
          !this.isSameShiftRecord(shift, currentShiftRecord) &&
          timeStringToMinutes(shift.startTime) > currentStartMinutes,
      ) ?? null
    );
  }

  private resolveShiftLookupDate(options: ConfirmShiftLookupOptions): Date {
    if (typeof options.shiftReferenceAt === 'number') {
      const referenceDate = new Date(options.shiftReferenceAt);
      if (!Number.isNaN(referenceDate.getTime())) {
        return referenceDate;
      }
    }

    return options.handoverAt;
  }

  private async loadShiftCandidates(
    storeId: number,
    referenceDate: Date,
    employeeId?: number | null,
  ): Promise<ShiftRecordRow[]> {
    return this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: buildDayRange(referenceDate),
      },
      select: CONFIRM_SHIFT_RECORD_SELECT,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
  }

  private pickShiftRecord(
    shifts: ShiftRecordRow[],
    options: ConfirmShiftLookupOptions,
  ): ShiftRecordRow | null {
    if (shifts.length === 0) {
      return null;
    }

    const normalizedOperatorName = toDisplayName(options.operatorName);
    const operatorScopedShifts = normalizedOperatorName
      ? shifts.filter(
          (shift) =>
            toDisplayName(shift.employeeName) === normalizedOperatorName,
        )
      : shifts;
    const candidateShifts =
      operatorScopedShifts.length > 0 ? operatorScopedShifts : shifts;

    if (typeof options.shiftReferenceAt === 'number') {
      const matchedByReferenceAt = candidateShifts.find(
        (shift) =>
          buildShiftDateRange(
            shift.startTime,
            shift.endTime,
            options.handoverAt,
          ).startAt.getTime() === options.shiftReferenceAt,
      );
      if (matchedByReferenceAt) {
        return matchedByReferenceAt;
      }
    }

    const activeShifts = candidateShifts.filter((shift) => {
      const shiftRange = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        options.handoverAt,
      );
      return (
        shiftRange.startAt.getTime() <= options.handoverAt.getTime() &&
        options.handoverAt.getTime() <= shiftRange.endAt.getTime()
      );
    });
    const activeMatchedShift = activeShifts.find(
      (shift) => shift.shiftType === options.shiftType,
    );
    if (activeMatchedShift) {
      return activeMatchedShift;
    }
    if (activeShifts.length > 0) {
      return activeShifts[0];
    }

    const matchedByType = candidateShifts.filter(
      (shift) => shift.shiftType === options.shiftType,
    );
    if (matchedByType.length > 0) {
      return matchedByType[0];
    }

    return candidateShifts[0] ?? null;
  }

  private buildShiftMatchConditions(
    shiftRecord: ShiftRecordRow,
    handoverAt: Date,
  ): Prisma.StoreHandoverRecordWhereInput[] {
    const fallbackShiftType =
      shiftRecord.shiftType ?? EmployeeShiftType.morning;
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
  }

  private isSameShiftRecord(
    left: ShiftRecordRow,
    right: ShiftRecordRow,
  ): boolean {
    return (
      left.employeeId === right.employeeId &&
      left.shiftType === right.shiftType &&
      left.startTime === right.startTime &&
      left.endTime === right.endTime
    );
  }
}
