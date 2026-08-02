import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { endOfDay, startOfDay, type ShiftRecordRow } from './handover.shared';
import { addShanghaiDays } from '../../../shared/shanghai-time.utils';
import { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
import {
  isSameShiftRecord,
  pickCurrentShift,
  pickStartedUnhandedShift,
} from './handover-shift-selection';

/**
 * 班次查询回溯天数上限（B2 fix）。
 * 业务取舍：规则 1 要求“不交班就一直存在”，但无下界查询会随门店年龄线性膨胀。
 * 超过该天数的未交班班次视为异常（应人工处理），不纳入自动查询范围。
 */
const SHIFT_LOOKUP_LOOKBACK_DAYS = 90;

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

  async findCurrentShiftRecord(
    storeId: number,
    employeeId: number | null,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const allShifts = await this.loadShifts(storeId, employeeId, referenceDate);
    const shiftsWithCompletion =
      await this.handoverStatus.attachCompletionStatus(storeId, allShifts);
    if (shiftsWithCompletion.length === 0) {
      return null;
    }

    return pickCurrentShift(shiftsWithCompletion, referenceDate);
  }

  async findStartedUnhandedShiftRecord(
    storeId: number,
    referenceDate = new Date(),
  ): Promise<ShiftRecordRow | null> {
    const allShifts = await this.loadShifts(storeId, null, referenceDate);
    const shiftsWithCompletion =
      await this.handoverStatus.attachCompletionStatus(storeId, allShifts);
    if (shiftsWithCompletion.length === 0) {
      return null;
    }

    return pickStartedUnhandedShift(shiftsWithCompletion, referenceDate);
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
      7, // B1 fix: 向前查看 7 天，覆盖跨天/多天排班场景
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

  private async loadShifts(
    storeId: number,
    employeeId: number | null,
    referenceDate: Date,
    forwardDays = 0,
  ): Promise<ShiftRecordRow[]> {
    return this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: this.buildShiftLookupRange(referenceDate, forwardDays),
      },
      select: this.shiftRecordSelect,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 构建班次查询日期范围。
   * - 下界：baseDate 前 SHIFT_LOOKUP_LOOKBACK_DAYS 天（B2 fix：防止历史班次无限膨胀）
   * - 上界：baseDate + forwardDays 天（B1 fix：支持跨天查找后续班次）
   */
  private buildShiftLookupRange(baseDate = new Date(), forwardDays = 0) {
    const lower = new Date(
      addShanghaiDays(
        startOfDay(baseDate).getTime(),
        -SHIFT_LOOKUP_LOOKBACK_DAYS,
      ),
    );
    const upperBase = endOfDay(baseDate).getTime();
    const upper = new Date(
      forwardDays > 0 ? addShanghaiDays(upperBase, forwardDays) : upperBase,
    );
    return {
      gte: lower,
      lte: upper,
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
