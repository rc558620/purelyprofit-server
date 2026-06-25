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

/** 批量预加载数据，用于 resolveRecordViewContextBatch */
type BatchPreloadedData = {
  /** employeeShiftId → { storeId, createdAt, date } */
  shiftsById: Map<number, { storeId: number; createdAt: Date; date: Date }>;
  /**
   * employeeId → 该员工近 7 天内的班次列表（兜底路径使用）
   * key: employeeId，value 按 startTime asc 排序
   */
  shiftsByEmployeeId: Map<number, RecordShiftSnapshot[]>;
  /** storeId 全店近 7 天班次（fromEmployeeId 为 null 时使用） */
  allStoreShifts: RecordShiftSnapshot[];
  /** employeeId → 员工 linkedStaffId + avatar */
  employeeProfiles: Map<
    number,
    { linkedStaffId: number | null; avatar: string | null }
  >;
};

@Injectable()
export class HandoverRecordsViewContextService {
  constructor(private readonly prisma: PrismaService) {}

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

    const preloaded = await this.preloadBatchData(storeId, records);

    return records.map((record) =>
      this.resolveRecordViewContextFromPreloaded(storeId, record, preloaded),
    );
  }

  private async preloadBatchData(
    storeId: number,
    records: HandoverRecordRow[],
  ): Promise<BatchPreloadedData> {
    // 收集所有需要预加载的 employeeShift id 和 employeeId
    const shiftIdSnapshotSet = new Set<number>();
    const employeeIdSet = new Set<number>();

    for (const record of records) {
      if (record.employeeShiftIdSnapshot) {
        shiftIdSnapshotSet.add(record.employeeShiftIdSnapshot);
      }
      if (record.fromEmployeeId) {
        employeeIdSet.add(record.fromEmployeeId);
      }
    }

    // 确定需要预加载兜底班次的时间范围（所有 record 中最早的 referenceDate - 7d）
    const referenceDates = records.map((r) => r.handoverAt ?? r.createdAt);
    const earliestRef = referenceDates.reduce(
      (min, d) => (d < min ? d : min),
      referenceDates[0],
    );
    const latestRef = referenceDates.reduce(
      (max, d) => (d > max ? d : max),
      referenceDates[0],
    );
    const fallbackDayStart = startOfDay(
      new Date(
        earliestRef.getFullYear(),
        earliestRef.getMonth(),
        earliestRef.getDate() - 7,
      ),
    );
    const fallbackDayEnd = endOfDay(latestRef);

    // 并行执行所有预加载查询
    const [
      snapshotShiftRows,
      employeeShiftRows,
      allStoreShiftRows,
      employeeRows,
    ] = await Promise.all([
      // 1. 精确快照 shift（by employeeShiftIdSnapshot）
      shiftIdSnapshotSet.size > 0
        ? this.prisma.employeeShift.findMany({
            where: { id: { in: Array.from(shiftIdSnapshotSet) } },
            select: { id: true, storeId: true, createdAt: true, date: true },
          })
        : Promise.resolve(
            [] as {
              id: number;
              storeId: number;
              createdAt: Date;
              date: Date;
            }[],
          ),

      // 2. 各员工近 7 天班次（兜底路径：fromEmployeeId 有值）
      employeeIdSet.size > 0
        ? this.prisma.employeeShift.findMany({
            where: {
              storeId,
              employeeId: { in: Array.from(employeeIdSet) },
              date: { gte: fallbackDayStart, lte: fallbackDayEnd },
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
          })
        : Promise.resolve(
            [] as Array<{
              employeeId: number | null;
              employeeName: string;
              shiftType: EmployeeShiftType | null;
              shiftName: string | null;
              date: Date;
              startTime: string;
              endTime: string;
            }>,
          ),

      // 3. 全店近 7 天班次（兜底路径：fromEmployeeId 为 null）
      records.some((r) => r.fromEmployeeId === null)
        ? this.prisma.employeeShift.findMany({
            where: {
              storeId,
              date: { gte: fallbackDayStart, lte: fallbackDayEnd },
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
          })
        : Promise.resolve(
            [] as Array<{
              employeeId: number | null;
              employeeName: string;
              shiftType: EmployeeShiftType | null;
              shiftName: string | null;
              date: Date;
              startTime: string;
              endTime: string;
            }>,
          ),

      // 4. 员工 profile（linkedStaffId + avatar）
      employeeIdSet.size > 0
        ? this.prisma.employee.findMany({
            where: { id: { in: Array.from(employeeIdSet) } },
            select: {
              id: true,
              linkedStaffId: true,
              avatar: true,
              linkedStaff: {
                select: { user: { select: { avatar: true } } },
              },
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: number;
              linkedStaffId: number | null;
              avatar: string | null;
              linkedStaff: { user: { avatar: string | null } } | null;
            }>,
          ),
    ]);

    // 组装 Map
    const shiftsById = new Map(
      snapshotShiftRows.map((s) => [
        s.id,
        { storeId: s.storeId, createdAt: s.createdAt, date: s.date },
      ]),
    );

    const shiftsByEmployeeId = new Map<number, RecordShiftSnapshot[]>();
    for (const row of employeeShiftRows) {
      if (row.employeeId === null) continue;
      const list = shiftsByEmployeeId.get(row.employeeId) ?? [];
      list.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        shiftType: row.shiftType,
        shiftName: row.shiftName,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
      });
      shiftsByEmployeeId.set(row.employeeId, list);
    }

    const allStoreShifts: RecordShiftSnapshot[] = allStoreShiftRows.map(
      (row) => ({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        shiftType: row.shiftType,
        shiftName: row.shiftName,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
      }),
    );

    const employeeProfiles = new Map(
      employeeRows.map((e) => [
        e.id,
        {
          linkedStaffId: e.linkedStaffId,
          avatar:
            toOptionalMediaText(e.avatar) ??
            toOptionalMediaText(e.linkedStaff?.user?.avatar) ??
            null,
        },
      ]),
    );

    return {
      shiftsById,
      shiftsByEmployeeId,
      allStoreShifts,
      employeeProfiles,
    };
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
    const operatorProfile = this.resolveRecordOperatorProfileFromPreloaded(
      record,
      shiftRecord,
      preloaded,
    );

    return {
      referenceDate,
      shiftRecord,
      shiftRange,
      operatorName: this.resolveRecordOperatorName(record, shiftRecord),
      operatorStaffId: operatorProfile.linkedStaffId,
      operatorAvatar: operatorProfile.avatar,
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
      const employeeShifts = (
        preloaded.shiftsByEmployeeId.get(record.fromEmployeeId) ?? []
      ).filter(
        (s) => s.date && s.date >= dayRange.gte && s.date <= dayRange.lte,
      );

      const matchedShift = employeeShifts.find((shift) => {
        const shiftRange = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date!,
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
            shift.date!,
          );
          return shiftRange.startAt.getTime() <= referenceDate.getTime();
        })
        .sort((left, right) => {
          const leftStartAt = buildShiftDateRange(
            left.startTime,
            left.endTime,
            left.date!,
          ).startAt;
          const rightStartAt = buildShiftDateRange(
            right.startTime,
            right.endTime,
            right.date!,
          ).startAt;
          return rightStartAt.getTime() - leftStartAt.getTime();
        })[0];

      return latestStartedShift ?? null;
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

  private resolveRecordOperatorProfileFromPreloaded(
    record: HandoverRecordRow,
    shiftRecord: RecordShiftSnapshot | null,
    preloaded: BatchPreloadedData,
  ): RecordOperatorProfile {
    const employeeId = shiftRecord?.employeeId ?? record.fromEmployeeId;
    if (!employeeId) {
      return { linkedStaffId: null, avatar: null };
    }

    return (
      preloaded.employeeProfiles.get(employeeId) ?? {
        linkedStaffId: null,
        avatar: null,
      }
    );
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
