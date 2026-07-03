import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  extendShiftRangeToReference,
  toDisplayName,
  type HandoverRecordRow,
  type RecordShiftSnapshot,
  type RecordViewContext,
  type ShiftDateRange,
} from './handover.shared';
import {
  buildFallbackDayRange,
  findLatestStartedShift,
  findMatchingShift,
} from './handover-record-shift-matcher';
import {
  HandoverRecordBatchPreloaderService,
  type BatchPreloadedData,
} from './handover-record-batch-preloader.service';
import { HandoverRecordOperatorProfileService } from './handover-record-operator-profile.service';

@Injectable()
export class HandoverRecordsViewContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchPreloader: HandoverRecordBatchPreloaderService,
    private readonly operatorProfile: HandoverRecordOperatorProfileService,
  ) {}

  /**
   * 批量解析一组 record 的视图上下文，避免逐条触发 N 次数据库查询。
   * 先一次性预加载所有 record 依赖的 employeeShift 和 employee 数据，
   * 再在内存中逐条解析，总查询次数从 O(N) 降为 O(1)（常数次）。
   */
  async resolveRecordViewContextBatch(
    storeId: number,
    records: HandoverRecordRow[],
  ): Promise<RecordViewContext[]> {
    if (records.length === 0) {
      return [];
    }

    const preloaded = await this.batchPreloader.preload(storeId, records);

    return records.map((record) =>
      this.resolveRecordViewContextFromPreloaded(storeId, record, preloaded),
    );
  }

  private resolveRecordViewContextFromPreloaded(
    storeId: number,
    record: HandoverRecordRow,
    preloaded: BatchPreloadedData,
  ): RecordViewContext {
    const referenceDate = record.handoverAt ?? record.createdAt;
    const shiftRecord = this.resolveRecordShiftRecordFromPreloaded(
      storeId,
      record,
      preloaded,
    );
    const shiftBaseDate = shiftRecord?.date ?? referenceDate;
    const shiftRange = this.buildRecordShiftRange(
      shiftBaseDate,
      shiftRecord,
      referenceDate,
    );
    const operatorProf = this.operatorProfile.resolveFromPreloaded(
      record,
      shiftRecord,
      preloaded,
    );

    return {
      referenceDate,
      shiftRecord,
      shiftRange,
      operatorName: HandoverRecordOperatorProfileService.resolveOperatorName(
        record,
        shiftRecord,
      ),
      operatorStaffId: operatorProf.linkedStaffId,
      operatorAvatar: operatorProf.avatar,
    };
  }

  private resolveRecordShiftRecordFromPreloaded(
    storeId: number,
    record: HandoverRecordRow,
    preloaded: BatchPreloadedData,
  ): RecordShiftSnapshot | null {
    const snapshotShiftRecord = this.buildRecordShiftSnapshotFromPreloaded(
      storeId,
      record,
      preloaded,
    );
    if (snapshotShiftRecord) {
      return snapshotShiftRecord;
    }

    const referenceDate = record.handoverAt ?? record.createdAt;
    const dayRange = buildFallbackDayRange(referenceDate);

    if (record.fromEmployeeId) {
      const employeeShifts = (
        preloaded.shiftsByEmployeeId.get(record.fromEmployeeId) ?? []
      ).filter(
        (s) => s.date && s.date >= dayRange.gte && s.date <= dayRange.lte,
      );

      return (
        findMatchingShift(
          employeeShifts,
          referenceDate,
          record.shiftTypeSnapshot,
        ) ??
        findLatestStartedShift(
          employeeShifts,
          referenceDate,
          record.shiftTypeSnapshot,
        )
      );
    }

    const allShifts = preloaded.allStoreShifts.filter(
      (s) => s.date && s.date >= dayRange.gte && s.date <= dayRange.lte,
    );

    return this.pickBestRecordShift(allShifts, referenceDate, record);
  }

  private buildRecordShiftSnapshotFromPreloaded(
    storeId: number,
    record: HandoverRecordRow,
    preloaded: BatchPreloadedData,
  ): RecordShiftSnapshot | null {
    const shiftType = record.shiftTypeSnapshot ?? null;
    const startTime = toDisplayName(record.shiftStartTimeSnapshot);
    const endTime = toDisplayName(record.shiftEndTimeSnapshot);
    if (!startTime || !endTime) {
      return null;
    }

    if (record.employeeShiftIdSnapshot) {
      const linkedShift = preloaded.shiftsById.get(
        record.employeeShiftIdSnapshot,
      );
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
    const operatorProf = await this.operatorProfile.resolveSingle(
      record,
      shiftRecord,
    );

    return {
      referenceDate,
      shiftRecord,
      shiftRange,
      operatorName: HandoverRecordOperatorProfileService.resolveOperatorName(
        record,
        shiftRecord,
      ),
      operatorStaffId: operatorProf.linkedStaffId ?? null,
      operatorAvatar: operatorProf.avatar,
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
    const dayRange = buildFallbackDayRange(referenceDate);

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

      return (
        findMatchingShift(
          employeeShifts,
          referenceDate,
          record.shiftTypeSnapshot,
        ) ??
        findLatestStartedShift(
          employeeShifts,
          referenceDate,
          record.shiftTypeSnapshot,
        )
      );
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

    const dated = candidateShifts.map((s) => ({
      ...s,
      date: s.date ?? referenceDate,
    }));

    return (
      findMatchingShift(dated, referenceDate, record.shiftTypeSnapshot) ??
      findLatestStartedShift(dated, referenceDate, record.shiftTypeSnapshot) ??
      dated[0] ??
      null
    );
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
}
