import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import { toOptionalMediaText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  endOfDay,
  extendShiftRangeToReference,
  startOfDay,
  toDisplayName,
  type HandoverRecordRow,
  type RecordShiftSnapshot,
  type RecordViewContext,
  type ShiftDateRange,
} from './handover.shared';

type RecordOperatorProfile = {
  linkedStaffId: number | null;
  avatar: string | null;
};

@Injectable()
export class HandoverRecordsViewContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveRecordViewContext(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<RecordViewContext> {
    const referenceDate = record.handoverAt ?? record.createdAt;
    const shiftRecord = await this.resolveRecordShiftRecord(storeId, record);
    const shiftBaseDate = shiftRecord?.date ?? referenceDate;
    const shiftRange = this.buildRecordShiftRange(
      shiftBaseDate,
      shiftRecord,
      referenceDate,
    );
    const operatorProfile = await this.resolveRecordOperatorProfile(
      record,
      shiftRecord,
    );

    return {
      referenceDate,
      shiftRecord,
      shiftRange,
      operatorName: this.resolveRecordOperatorName(record, shiftRecord),
      operatorStaffId: operatorProfile.linkedStaffId ?? null,
      operatorAvatar: operatorProfile.avatar,
    };
  }

  private buildRecordShiftRange(
    baseDate: Date,
    shiftRecord: RecordShiftSnapshot | null,
    extendToReference?: Date,
  ): ShiftDateRange {
    const fallbackShiftType =
      shiftRecord?.shiftType ?? EmployeeShiftType.morning;
    const fallbackTime = SHIFT_TIME_FALLBACKS[fallbackShiftType];

    return extendShiftRangeToReference(
      buildShiftDateRange(
        shiftRecord?.startTime ?? fallbackTime.startTime,
        shiftRecord?.endTime ?? fallbackTime.endTime,
        baseDate,
      ),
      extendToReference ?? baseDate,
    );
  }

  private resolveRecordOperatorName(
    record: HandoverRecordRow,
    shiftRecord: RecordShiftSnapshot | null,
  ): string {
    return (
      toDisplayName(shiftRecord?.employeeName) ??
      toDisplayName(record.fromEmployeeNameSnapshot) ??
      toDisplayName(record.fromEmployee?.name) ??
      toDisplayName(record.toEmployee?.name) ??
      '未知员工'
    );
  }

  private async resolveRecordShiftRecord(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<RecordShiftSnapshot | null> {
    const snapshotShiftRecord = await this.buildRecordShiftSnapshot(
      storeId,
      record,
    );
    if (snapshotShiftRecord) {
      return snapshotShiftRecord;
    }

    const referenceDate = record.handoverAt ?? record.createdAt;
    const dayRange = {
      gte: startOfDay(
        new Date(
          referenceDate.getFullYear(),
          referenceDate.getMonth(),
          referenceDate.getDate() - 7,
        ),
      ),
      lte: endOfDay(referenceDate),
    };

    if (record.fromEmployeeId) {
      const employeeShifts = await this.prisma.employeeShift.findMany({
        where: {
          storeId,
          employeeId: record.fromEmployeeId,
          date: dayRange,
        },
        select: {
          employeeId: true,
          employeeName: true,
          shiftType: true,
          shiftName: true,
          date: true,
          startTime: true,
          endTime: true,
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });
      const matchedShift = employeeShifts.find((shift) => {
        const shiftRange = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date,
        );
        return (
          shiftRange.startAt.getTime() <= referenceDate.getTime() &&
          referenceDate.getTime() <= shiftRange.endAt.getTime()
        );
      });
      if (matchedShift) {
        return matchedShift;
      }

      const latestStartedShift = employeeShifts
        .filter((shift) => {
          const shiftRange = buildShiftDateRange(
            shift.startTime,
            shift.endTime,
            shift.date,
          );
          return shiftRange.startAt.getTime() <= referenceDate.getTime();
        })
        .sort((left, right) => {
          const leftStartAt = buildShiftDateRange(
            left.startTime,
            left.endTime,
            left.date,
          ).startAt;
          const rightStartAt = buildShiftDateRange(
            right.startTime,
            right.endTime,
            right.date,
          ).startAt;
          return rightStartAt.getTime() - leftStartAt.getTime();
        })[0];

      return latestStartedShift ?? null;
    }

    const allShifts = await this.prisma.employeeShift.findMany({
      where: {
        storeId,
        date: dayRange,
      },
      select: {
        employeeId: true,
        employeeName: true,
        shiftType: true,
        shiftName: true,
        date: true,
        startTime: true,
        endTime: true,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });

    return this.pickBestRecordShift(allShifts, referenceDate, record);
  }

  private pickBestRecordShift(
    shifts: RecordShiftSnapshot[],
    referenceDate: Date,
    record: HandoverRecordRow,
  ): RecordShiftSnapshot | null {
    if (shifts.length === 0) {
      return null;
    }

    const snapshotEmployeeName =
      toDisplayName(record.fromEmployeeNameSnapshot) ??
      toDisplayName(record.fromEmployee?.name);
    const nameScopedShifts = snapshotEmployeeName
      ? shifts.filter(
          (shift) => toDisplayName(shift.employeeName) === snapshotEmployeeName,
        )
      : shifts;
    const candidateShifts =
      nameScopedShifts.length > 0 ? nameScopedShifts : shifts;

    const activeShifts = candidateShifts.filter((shift) => {
      const shiftRange = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date ?? referenceDate,
      );
      return (
        shiftRange.startAt.getTime() <= referenceDate.getTime() &&
        referenceDate.getTime() <= shiftRange.endAt.getTime()
      );
    });
    const activeMatchedShift = this.pickByShiftType(
      activeShifts,
      record.shiftTypeSnapshot ?? null,
    );
    if (activeMatchedShift) {
      return activeMatchedShift;
    }

    const startedShifts = candidateShifts
      .filter((shift) => {
        const shiftRange = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date ?? referenceDate,
        );
        return shiftRange.startAt.getTime() <= referenceDate.getTime();
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
    const latestStartedShift = this.pickByShiftType(
      startedShifts,
      record.shiftTypeSnapshot ?? null,
    );
    if (latestStartedShift) {
      return latestStartedShift;
    }

    return (
      this.pickByShiftType(candidateShifts, record.shiftTypeSnapshot ?? null) ??
      candidateShifts[0] ??
      null
    );
  }

  private pickByShiftType(
    shifts: RecordShiftSnapshot[],
    shiftType: HandoverRecordRow['shiftTypeSnapshot'],
  ): RecordShiftSnapshot | null {
    if (!shiftType) {
      return shifts[0] ?? null;
    }

    return shifts.find((shift) => shift.shiftType === shiftType) ?? null;
  }

  private async buildRecordShiftSnapshot(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<RecordShiftSnapshot | null> {
    const shiftType = record.shiftTypeSnapshot ?? null;
    const startTime = toDisplayName(record.shiftStartTimeSnapshot);
    const endTime = toDisplayName(record.shiftEndTimeSnapshot);
    if (!startTime || !endTime) {
      return null;
    }

    if (record.employeeShiftIdSnapshot) {
      const linkedShift = await this.prisma.employeeShift.findUnique({
        where: { id: record.employeeShiftIdSnapshot },
        select: {
          storeId: true,
          createdAt: true,
          date: true,
        },
      });
      if (
        linkedShift &&
        (linkedShift.storeId !== storeId ||
          linkedShift.createdAt.getTime() > record.createdAt.getTime())
      ) {
        return null;
      }

      return {
        employeeId: record.fromEmployeeId,
        employeeName:
          toDisplayName(record.fromEmployeeNameSnapshot) ??
          toDisplayName(record.fromEmployee?.name) ??
          null,
        shiftType,
        shiftName: toDisplayName(record.shiftNameSnapshot),
        date: linkedShift?.date,
        startTime,
        endTime,
      };
    }

    return {
      employeeId: record.fromEmployeeId,
      employeeName:
        toDisplayName(record.fromEmployeeNameSnapshot) ??
        toDisplayName(record.fromEmployee?.name) ??
        null,
      shiftType,
      shiftName: toDisplayName(record.shiftNameSnapshot),
      startTime,
      endTime,
    };
  }

  private async resolveRecordOperatorProfile(
    record: HandoverRecordRow,
    shiftRecord: RecordShiftSnapshot | null,
  ): Promise<RecordOperatorProfile> {
    const employeeId = shiftRecord?.employeeId ?? record.fromEmployeeId;
    if (!employeeId) {
      return {
        linkedStaffId: null,
        avatar: null,
      };
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        linkedStaffId: true,
        avatar: true,
        linkedStaff: {
          select: {
            user: {
              select: {
                avatar: true,
              },
            },
          },
        },
      },
    });

    return {
      linkedStaffId: employee?.linkedStaffId ?? null,
      avatar:
        toOptionalMediaText(employee?.avatar) ??
        toOptionalMediaText(employee?.linkedStaff?.user?.avatar) ??
        null,
    };
  }
}
