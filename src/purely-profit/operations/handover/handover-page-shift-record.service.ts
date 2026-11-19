import { Injectable } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildShiftDateRange,
  endOfDay,
  startOfDay,
  type ShiftRecordRow,
} from './handover.shared';
import { addShanghaiDays } from '../../../shared/shanghai-time.utils';
import { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
import {
  isSameShiftRecord,
  pickCurrentShift,
  pickStartedUnhandedShift,
} from './handover-shift-selection';

/**
 * 班次查询的可选边界。
 * 默认不设日期下界：业务规则要求「不点交班则班次一直存在」，
 * 任何固定回溯天数都会让未交班班次随日历推进被静默丢弃。
 */
type ShiftLookupOptions = {
  /** 从基准日向前查看的天数，用于查找后续班次 */
  forwardDays?: number;
  /** 明确的下界日期，仅用于查找某班次之后的班次等前向查询 */
  lowerBoundDate?: Date;
  /** 需要排除的班次 id（已通过快照精确交班），交给 DB 侧过滤 */
  excludedShiftIds?: number[];
};

type ShiftLookupRange = {
  gte?: Date;
  lte: Date;
};

/**
 * 请求级「后续班次」查询缓存。
 *
 * 交班页里同一 (门店, 基准班次, 员工范围) 会被问两次：
 * findReceiverCandidate 问「有没有接班人」，resolveHandoverCompletedAndNoUpcomingShift
 * 再问一次「有没有后续班次」——两者落到 findNextShiftRecord 的参数完全相同。
 * 缓存的是 Promise，因此即便两条链路并发也不会重复打到 DB。
 *
 * ⚠️ 与交班状态 memo 一样只能活在单次请求内：
 * 排班会随时被改写，跨请求复用会读到陈旧班次。
 */
export type NextShiftLookupMemo = Map<string, Promise<ShiftRecordRow | null>>;

@Injectable()
export class HandoverPageShiftRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handoverStatus: HandoverShiftHandoverStatusService,
  ) {}

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

  /**
   * 当前班次：把「已有精确快照的已交班班次」下推成 DB 侧 NOT IN 过滤。
   *
   * 业务要求「不点交班则班次一直存在」，所以日期下界必须不设；但绝大多数历史
   * 班次都已通过 employeeShiftIdSnapshot 精确关联交班记录。把这部分判定交给
   * 数据库后，带回内存的只剩「未交班 + 无快照的历史脏数据」，老店从数千行
   * 降到常数级，兜底匹配的窗口也从「开业至今」收敛到这批候选的区间。
   */
  async findCurrentShiftRecord(
    storeId: number,
    employeeId: number | null,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const candidateShifts = await this.loadUnhandedCandidateShifts(
      storeId,
      employeeId,
      referenceDate,
    );
    if (candidateShifts.length === 0) {
      return null;
    }

    const shiftsWithCompletion =
      await this.handoverStatus.attachCompletionStatus(
        storeId,
        candidateShifts,
      );

    return pickCurrentShift(shiftsWithCompletion, referenceDate);
  }

  async findStartedUnhandedShiftRecord(
    storeId: number,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const candidateShifts = await this.loadUnhandedCandidateShifts(
      storeId,
      null,
      referenceDate,
    );
    if (candidateShifts.length === 0) {
      return null;
    }

    const shiftsWithCompletion =
      await this.handoverStatus.attachCompletionStatus(
        storeId,
        candidateShifts,
      );

    return pickStartedUnhandedShift(shiftsWithCompletion, referenceDate);
  }

  /**
   * 候选班次 = 该范围内「没有被 employeeShiftIdSnapshot 精确关联到已完成交班记录」的班次。
   *
   * 只做精确快照排除，不做时间窗口兜底匹配：兜底（历史无快照记录）仍由
   * HandoverShiftHandoverStatusService 负责，保证判定口径只有一处。
   */
  private async loadUnhandedCandidateShifts(
    storeId: number,
    employeeId: number | null,
    referenceDate: Date,
  ): Promise<ShiftRecordRow[]> {
    const snapshotRecords = await this.prisma.storeHandoverRecord.findMany({
      where: {
        storeId,
        status: HandoverStatus.completed,
        employeeShiftIdSnapshot: { not: null },
      },
      select: { employeeShiftIdSnapshot: true },
    });
    const handedOverShiftIds = [
      ...new Set(
        snapshotRecords
          .map((record) => record.employeeShiftIdSnapshot)
          .filter((id): id is number => id !== null),
      ),
    ];

    return this.loadShifts(storeId, employeeId, referenceDate, {
      excludedShiftIds: handedOverShiftIds,
    });
  }

  async findNextShiftRecord(
    storeId: number,
    currentShiftRecord: ShiftRecordRow | null,
    employeeId?: number | null,
    memo?: NextShiftLookupMemo,
  ): Promise<ShiftRecordRow | null> {
    if (!currentShiftRecord) {
      return null;
    }

    const memoKey = memo
      ? this.buildNextShiftMemoKey(storeId, currentShiftRecord, employeeId)
      : null;
    const cached = memoKey ? memo?.get(memoKey) : undefined;
    if (cached) {
      return cached;
    }

    const pending = this.loadNextShiftRecord(
      storeId,
      currentShiftRecord,
      employeeId,
    );
    if (memo && memoKey) {
      memo.set(memoKey, pending);
    }

    return pending;
  }

  private async loadNextShiftRecord(
    storeId: number,
    currentShiftRecord: ShiftRecordRow,
    employeeId?: number | null,
  ): Promise<ShiftRecordRow | null> {
    // 后续班次只需要当前班次日期之后的数据：显式给下界，避免把门店全部历史排班拉进内存。
    const allShifts = await this.loadShifts(
      storeId,
      employeeId ?? null,
      currentShiftRecord.date,
      {
        forwardDays: 7, // B1 fix: 向前查看 7 天，覆盖跨天/多天排班场景
        lowerBoundDate: currentShiftRecord.date,
      },
    );
    if (allShifts.length === 0) {
      return null;
    }

    const currentShiftIndex = allShifts.findIndex((shift) =>
      isSameShiftRecord(shift, currentShiftRecord),
    );
    if (currentShiftIndex < 0) {
      return null;
    }

    // 与确认交班（resolveReceiverCandidate）共用同一接班人选择规则：
    // 只有开始时间不早于当前班次结束时间的班次才算接班人，排班重叠时跳过，
    // 避免页面预览的接班人与实际保存的结果不一致。
    const currentRange = buildShiftDateRange(
      currentShiftRecord.startTime,
      currentShiftRecord.endTime,
      currentShiftRecord.date,
    );

    return (
      allShifts.slice(currentShiftIndex + 1).find((shift) => {
        const range = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date,
        );
        return range.startAt.getTime() >= currentRange.endAt.getTime();
      }) ?? null
    );
  }

  /** memo key：同一门店内 (基准班次, 员工范围) 唯一确定一次后续班次查询 */
  private buildNextShiftMemoKey(
    storeId: number,
    shift: ShiftRecordRow,
    employeeId?: number | null,
  ): string {
    const shiftKey =
      shift.id ??
      `${shift.date.getTime()}|${shift.startTime}|${shift.endTime}|${shift.employeeId ?? 'null'}`;

    return `${storeId}:${shiftKey}:${employeeId ?? 'all'}`;
  }

  /**
   * 查找日期上界内最后一个班次（不区分是否已交班）。
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

  /**
   * 加载候选班次。默认不设日期下界，使「未交班班次一直存在」不受门店年龄影响；
   * 查询依赖 EmployeeShift 的 @@index([storeId, date])，按门店 + 日期上界命中索引。
   */
  private async loadShifts(
    storeId: number,
    employeeId: number | null,
    referenceDate: Date,
    options: ShiftLookupOptions = {},
  ): Promise<ShiftRecordRow[]> {
    const excludedShiftIds = options.excludedShiftIds ?? [];

    return this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: this.buildShiftLookupRange(referenceDate, options),
        // 已通过快照精确交班的班次直接交给 DB 排除，避免整店历史排班进内存
        ...(excludedShiftIds.length > 0
          ? { id: { notIn: excludedShiftIds } }
          : {}),
      },
      select: this.shiftRecordSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 构建班次查询日期范围。
   * - 下界：默认不设；仅在显式传入 lowerBoundDate 时收敛（后续班次查询）
   * - 上界：baseDate + forwardDays 天（B1 fix：支持跨天查找后续班次）
   */
  private buildShiftLookupRange(
    baseDate = new Date(),
    options: ShiftLookupOptions = {},
  ): ShiftLookupRange {
    const { forwardDays = 0, lowerBoundDate } = options;
    const upperBase = endOfDay(baseDate).getTime();
    const lte = new Date(
      forwardDays > 0 ? addShanghaiDays(upperBase, forwardDays) : upperBase,
    );

    return {
      ...(lowerBoundDate ? { gte: startOfDay(lowerBoundDate) } : {}),
      lte,
    };
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
