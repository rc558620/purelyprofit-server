import { ConflictException, Injectable } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  endOfDay,
  startOfDay,
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

/**
 * 班次结束后允许交班定位的宽限期（小时）。
 * 规则 5 要求交班必须发生在班次结束之后（handoverAt 恒 > endAt），
 * 因此把"active"窗口从 [startAt, endAt] 扩展为 [startAt, endAt + 宽限]，
 * 使刚结束的班次在交班时仍可被 active 逻辑选中，避免其成为死代码。
 */
const HANDOVER_SHIFT_GRACE_HOURS = 4;

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
    const matched = this.pickShiftRecord(storeShifts, options);

    // F4 修复：当未传 shiftReferenceAt 且当天未找到班次时，向前回溯一天查找历史未交班次。
    // 不复用 pickShiftRecord（其 active 窗口以 handoverAt 为基准，对昨天班次语义错误），
    // 改为基于各班次自身 shift.date 计算时段，筛选未交班后取最早已过期班次（与规则1对齐）。
    if (!matched && typeof options.shiftReferenceAt !== 'number') {
      const oneDayBefore = new Date(shiftLookupDate);
      oneDayBefore.setDate(oneDayBefore.getDate() - 1);
      const extendedRange = {
        gte: startOfDay(oneDayBefore),
        lte: endOfDay(shiftLookupDate),
      };
      const extendedShifts = await this.prisma.employeeShift.findMany({
        where: { storeId, date: extendedRange },
        select: CONFIRM_SHIFT_RECORD_SELECT,
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      });
      if (extendedShifts.length > 0) {
        return this.pickEarliestUnhandedShift(storeId, extendedShifts, options);
      }
    }

    return matched;
  }

  async ensureShiftNotHandedOver(
    prismaClient: PrismaService | Prisma.TransactionClient,
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
      // F2 修复：统一使用 shiftRecord.date 作为基准，与 handover-confirm.service.ts 和
      // handover-shift-handover-status.service.ts 保持一致，避免跨夜/跨日窗口偏移
      const shiftRange = buildShiftDateRange(
        shiftRecord.startTime,
        shiftRecord.endTime,
        shiftRecord.date,
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

    const exists = await prismaClient.storeHandoverRecord.count({ where });
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

    // B1 fix: 向前查看 7 天，覆盖跨天/多天排班场景
    const allShifts = await this.loadShiftCandidates(
      storeId,
      handoverAt,
      null,
      7,
    );
    // F5+F6 修复：使用完整 startAt/endAt 判定下一班次，正确处理跨夜班次；
    // 回退分支改为 startAt > currentEndAt，排除时段重叠班次（与规则6对齐）。
    const currentRange = buildShiftDateRange(
      currentShiftRecord.startTime,
      currentShiftRecord.endTime,
      currentShiftRecord.date,
    );

    const nextByEndTime = allShifts.find((shift) => {
      if (this.isSameShiftRecord(shift, currentShiftRecord)) return false;
      const shiftStart = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        shift.date,
      ).startAt;
      return shiftStart.getTime() >= currentRange.endAt.getTime();
    });
    if (nextByEndTime) {
      return nextByEndTime;
    }

    return (
      allShifts.find((shift) => {
        if (this.isSameShiftRecord(shift, currentShiftRecord)) return false;
        const shiftStart = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date,
        ).startAt;
        return shiftStart.getTime() > currentRange.endAt.getTime();
      }) ?? null
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
    forwardDays = 0,
  ): Promise<ShiftRecordRow[]> {
    const lower = startOfDay(referenceDate);
    const upper = endOfDay(referenceDate);
    if (forwardDays > 0) {
      upper.setDate(upper.getDate() + forwardDays);
    }
    return this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: { gte: lower, lte: upper },
      },
      select: CONFIRM_SHIFT_RECORD_SELECT,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
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
      // B5 fix: 未传 shiftReferenceAt 时，使用班次自身 date 计算时段，
      // 排除跨天场景下非同日班次的误匹配
      const rangeBase =
        typeof options.shiftReferenceAt === 'number'
          ? options.handoverAt
          : shift.date;
      const shiftRange = buildShiftDateRange(
        shift.startTime,
        shift.endTime,
        rangeBase,
      );
      // 宽限窗口：班次结束后 HANDOVER_SHIFT_GRACE_HOURS 小时内仍视为 active，
      // 让刚结束的班次在合法交班时刻（handoverAt > endAt）可被精准选中。
      const graceEndAt = new Date(shiftRange.endAt);
      graceEndAt.setHours(graceEndAt.getHours() + HANDOVER_SHIFT_GRACE_HOURS);
      return (
        shiftRange.startAt.getTime() <= options.handoverAt.getTime() &&
        options.handoverAt.getTime() <= graceEndAt.getTime()
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

    // B5 fix: 未传 shiftReferenceAt 时，仅匹配与 handoverAt 同日的班次，
    // 防止跨天场景下 shiftType 兜底误匹配到非目标日期的班次
    const sameDayFilter =
      typeof options.shiftReferenceAt !== 'number'
        ? (s: ShiftRecordRow) =>
            startOfDay(s.date).getTime() ===
            startOfDay(options.handoverAt).getTime()
        : () => true;
    const matchedByType = candidateShifts.filter(
      (shift) => shift.shiftType === options.shiftType && sameDayFilter(shift),
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

  /**
   * F4: 基于各班次自身 shift.date 计算时段，筛选已过期且未交班的班次，取最早的一条。
   * 用于历史未交班次回溯场景，避免 pickShiftRecord 以 handoverAt 为基准导致的语义错误。
   */
  private async pickEarliestUnhandedShift(
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
