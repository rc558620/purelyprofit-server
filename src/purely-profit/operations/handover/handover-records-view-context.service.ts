import { Injectable } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  extendShiftRangeToReference,
  toDisplayName,
  type HandoverRecordShiftRow,
  type RecordShiftContext,
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
import {
  HandoverRecordOperatorProfileService,
  type RecordOperatorProfile,
} from './handover-record-operator-profile.service';

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
    records: readonly HandoverRecordShiftRow[],
  ): Promise<RecordViewContext[]> {
    if (records.length === 0) {
      return [];
    }

    const preloaded = await this.batchPreloader.preload(storeId, records);
    const contexts = records.map((record) =>
      this.resolveRecordViewContextFromPreloaded(storeId, record, preloaded),
    );

    // 上一班延迟交班时，其记录已覆盖到实际交班时刻；历史记录若不收窄起点，
    // 同一时段会同时计入两班（实时页已按此口径收窄，历史页必须对齐）。
    const handoverInstants = await this.loadPreviousHandoverInstants(
      storeId,
      contexts,
    );

    return contexts.map((context) =>
      this.narrowShiftRangeStart(context, handoverInstants),
    );
  }

  private resolveRecordViewContextFromPreloaded(
    storeId: number,
    record: HandoverRecordShiftRow,
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
      operatorAvatar: operatorProf.avatar,
    };
  }

  private resolveRecordShiftRecordFromPreloaded(
    storeId: number,
    record: HandoverRecordShiftRow,
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

      return this.pickEmployeeShiftFallback(
        employeeShifts,
        referenceDate,
        record,
      );
    }

    const allShifts = preloaded.allStoreShifts.filter(
      (s) => s.date && s.date >= dayRange.gte && s.date <= dayRange.lte,
    );

    return this.pickBestRecordShift(allShifts, referenceDate, record);
  }

  private buildRecordShiftSnapshotFromPreloaded(
    storeId: number,
    record: HandoverRecordShiftRow,
    preloaded: BatchPreloadedData,
  ): RecordShiftSnapshot | null {
    const times = this.readRecordShiftTimes(record);
    if (!times) {
      return null;
    }

    const linkedShift = record.employeeShiftIdSnapshot
      ? preloaded.shiftsById.get(record.employeeShiftIdSnapshot)
      : undefined;
    if (!this.isSnapshotShiftUsable(linkedShift, storeId, record)) {
      return null;
    }

    return this.buildShiftSnapshotFromRecord(
      record,
      times.startTime,
      times.endTime,
      linkedShift?.date,
    );
  }

  /**
   * 只解析「班次归属 + 时间范围」（1 次查询）。
   * 详情页营收聚合只需要 shiftRange，先拿这一半即可把营收与头像查询并行。
   */
  async resolveRecordShiftContext(
    storeId: number,
    record: HandoverRecordShiftRow,
  ): Promise<RecordShiftContext> {
    const referenceDate = record.handoverAt ?? record.createdAt;
    const shiftRecord = await this.resolveRecordShiftRecord(storeId, record);
    const shiftBaseDate = shiftRecord?.date ?? referenceDate;
    const shiftRange = this.buildRecordShiftRange(
      shiftBaseDate,
      shiftRecord,
      referenceDate,
    );
    const previousHandoverAt = await this.loadPreviousHandoverAt(
      storeId,
      shiftRange.startAt,
      referenceDate,
    );

    return {
      referenceDate,
      shiftRecord,
      shiftRange: previousHandoverAt
        ? { ...shiftRange, startAt: previousHandoverAt }
        : shiftRange,
      // 展示锚点固定为班次原始开始时间，不受统计区间收窄影响
      shiftStartAt: shiftRange.startAt,
    };
  }

  /** 操作员档案（linkedStaffId + 头像）：仅在需要展示头像的路径查询 */
  async resolveOperatorProfile(
    record: HandoverRecordShiftRow,
    shiftRecord: RecordShiftSnapshot | null,
  ): Promise<RecordOperatorProfile> {
    return this.operatorProfile.resolveSingle(record, shiftRecord);
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

  /**
   * 批量预加载「统计区间内已完成的交班时刻」，供各记录把起点收窄到上一班实际交班时间。
   * 与实时页 findShiftInitializedStartAt 的口径保持一致（全店时间线）。
   */
  private async loadPreviousHandoverInstants(
    storeId: number,
    contexts: readonly RecordViewContext[],
  ): Promise<Date[]> {
    if (contexts.length === 0) {
      return [];
    }

    const lower = Math.min(
      ...contexts.map((item) => item.shiftRange.startAt.getTime()),
    );
    const upper = Math.max(
      ...contexts.map((item) => item.referenceDate.getTime()),
    );
    if (lower >= upper) {
      return [];
    }

    const rows = await this.prisma.storeHandoverRecord.findMany({
      where: {
        storeId,
        status: HandoverStatus.completed,
        handoverAt: { gt: new Date(lower), lt: new Date(upper) },
      },
      select: { handoverAt: true },
      orderBy: [{ handoverAt: 'desc' }, { id: 'desc' }],
    });

    return rows
      .map((row) => row.handoverAt)
      .filter((value): value is Date => value !== null);
  }

  private async loadPreviousHandoverAt(
    storeId: number,
    startAt: Date,
    referenceDate: Date,
  ): Promise<Date | null> {
    if (startAt.getTime() >= referenceDate.getTime()) {
      return null;
    }

    const row = await this.prisma.storeHandoverRecord.findFirst({
      where: {
        storeId,
        status: HandoverStatus.completed,
        handoverAt: { gt: startAt, lt: referenceDate },
      },
      select: { handoverAt: true },
      orderBy: [{ handoverAt: 'desc' }, { id: 'desc' }],
    });

    const previous = row?.handoverAt ?? null;
    if (!previous) {
      return null;
    }
    // 二次校验：只有严格落在[班次开始, 本次交班) 区间内的交班时刻才能作为统计起点，
    // 否则会把统计区间收成空区间（startAt >= referenceDate）导致营收全部丢失。
    const previousAt = previous.getTime();
    return previousAt > startAt.getTime() &&
      previousAt < referenceDate.getTime()
      ? previous
      : null;
  }

  private narrowShiftRangeStart(
    context: RecordViewContext,
    handoverInstants: readonly Date[],
  ): RecordViewContext {
    const startAt = context.shiftRange.startAt.getTime();
    const referenceAt = context.referenceDate.getTime();
    if (startAt >= referenceAt) {
      return context;
    }

    const previous = handoverInstants.find((instant) => {
      const time = instant.getTime();
      return time > startAt && time < referenceAt;
    });
    if (!previous) {
      return context;
    }

    return {
      ...context,
      shiftRange: { ...context.shiftRange, startAt: previous },
    };
  }

  private async resolveRecordShiftRecord(
    storeId: number,
    record: HandoverRecordShiftRow,
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

      return this.pickEmployeeShiftFallback(
        employeeShifts,
        referenceDate,
        record,
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
    record: HandoverRecordShiftRow,
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
    record: HandoverRecordShiftRow,
  ): Promise<RecordShiftSnapshot | null> {
    const times = this.readRecordShiftTimes(record);
    if (!times) {
      return null;
    }

    const linkedShift = record.employeeShiftIdSnapshot
      ? await this.prisma.employeeShift.findUnique({
          where: { id: record.employeeShiftIdSnapshot },
          select: {
            storeId: true,
            createdAt: true,
            date: true,
          },
        })
      : null;
    if (!this.isSnapshotShiftUsable(linkedShift, storeId, record)) {
      return null;
    }

    return this.buildShiftSnapshotFromRecord(
      record,
      times.startTime,
      times.endTime,
      linkedShift?.date,
    );
  }

  /** 读取记录上的班次时间快照；缺失时无法组装班次视图，回退到时间窗口匹配。 */
  private readRecordShiftTimes(
    record: HandoverRecordShiftRow,
  ): { startTime: string; endTime: string } | null {
    const startTime = toDisplayName(record.shiftStartTimeSnapshot);
    const endTime = toDisplayName(record.shiftEndTimeSnapshot);
    if (!startTime || !endTime) {
      return null;
    }

    return { startTime, endTime };
  }

  /**
   * 快照关联班次是否可用：跨店或创建时间晚于交班记录的快照视为失效。
   * 批量路径与单条路径共用同一判定，避免两条链路的兜底口径分叉。
   */
  private isSnapshotShiftUsable(
    linkedShift: { storeId: number; createdAt: Date } | null | undefined,
    storeId: number,
    record: HandoverRecordShiftRow,
  ): boolean {
    if (!linkedShift) {
      return true;
    }

    return (
      linkedShift.storeId === storeId &&
      linkedShift.createdAt.getTime() <= record.createdAt.getTime()
    );
  }

  /** 由记录快照字段组装班次视图，批量与单条路径共用同一字段口径。 */
  private buildShiftSnapshotFromRecord(
    record: HandoverRecordShiftRow,
    startTime: string,
    endTime: string,
    shiftDate?: Date,
  ): RecordShiftSnapshot {
    return {
      employeeId: record.fromEmployeeId,
      employeeName:
        toDisplayName(record.fromEmployeeNameSnapshot) ??
        toDisplayName(record.fromEmployee?.name) ??
        null,
      shiftType: record.shiftTypeSnapshot ?? null,
      shiftName: toDisplayName(record.shiftNameSnapshot),
      date: shiftDate,
      startTime,
      endTime,
    };
  }

  /** 兜底匹配：优先时间区间覆盖，其次取已开始的最近班次。 */
  private pickEmployeeShiftFallback(
    shifts: RecordShiftSnapshot[],
    referenceDate: Date,
    record: HandoverRecordShiftRow,
  ): RecordShiftSnapshot | null {
    return (
      findMatchingShift(shifts, referenceDate, record.shiftTypeSnapshot) ??
      findLatestStartedShift(shifts, referenceDate, record.shiftTypeSnapshot)
    );
  }
}
