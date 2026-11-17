import { Injectable } from '@nestjs/common';
import { HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildShiftDateRange,
  buildShiftGraceEndAt,
  type ShiftRecordRow,
} from './handover.shared';

/** 兜底匹配条目：只保留二分定位需要的毫秒时间戳（避免每条班次重复 getTime） */
type HandoverRangeEntry = {
  handoverAtMs: number;
  createdAtMs: number | null;
};

/** 已交班班次的标识集合（精确 ID + 时间范围兜底） */
export type HandedOverShiftIds = {
  byShiftId: Set<number>;
  /**
   * employeeId → 该员工按 handoverAt 升序排列的兜底条目。
   *
   * ─── 为什么按员工分桶 + 排序 ────────────────────────────────────
   * 原实现是「每条班次 × 每条兜底记录」线性扫描（O(N×M)）。
   * 门店排班历史随营业天数线性增长（老店可达数千条班次），
   * 无 snapshot 的历史交班记录同样线性增长，两者相乘会让
   * attachCompletionStatus 从「几毫秒」退化成「数百毫秒的纯 CPU 开销」。
   * 分桶 + 升序后，每条班次只需一次二分定位 + 命中窗口内的常数条比较。
   */
  byRangeByEmployeeId: Map<number, HandoverRangeEntry[]>;
};

/** 二分查找首个 handoverAt >= targetMs 的下标（entries 必须已按 handoverAt 升序） */
const findFirstRangeAtOrAfter = (
  entries: readonly HandoverRangeEntry[],
  targetMs: number,
): number => {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (entries[mid].handoverAtMs < targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

/**
 * 请求级交班状态缓存（shiftId → 已完成交班）。
 *
 * ⚠️ 生命周期只能是一次请求内的局部变量：交班是写操作，
 * 跨请求复用会让 canOperate 读到陈旧状态，直接放行或误拦交班。
 */
export type ShiftHandoverStatusMemo = Map<number, boolean>;

/**
 * 构造「该班次已交班」的匹配条件。
 * - 优先：employeeShiftIdSnapshot 精确匹配 shift.id
 * - 兜底：employeeShiftIdSnapshot IS NULL + handoverAt 在 shift 时间段内（含宽限期）
 */
const buildShiftMatchConditions = (
  shiftRecord: ShiftRecordRow,
): Prisma.StoreHandoverRecordWhereInput[] => {
  const shiftRange = buildShiftDateRange(
    shiftRecord.startTime,
    shiftRecord.endTime,
    shiftRecord.date,
  );
  const createdAtCondition = shiftRecord.createdAt
    ? { createdAt: { gte: shiftRecord.createdAt } }
    : {};
  const conditions: Prisma.StoreHandoverRecordWhereInput[] = [
    {
      employeeShiftIdSnapshot: null,
      handoverAt: {
        gte: shiftRange.startAt,
        // 上界含宽限期：合法交班的 handoverAt 恒 > endAt（规则 5）
        lte: buildShiftGraceEndAt(shiftRange),
      },
      ...createdAtCondition,
    } as Prisma.StoreHandoverRecordWhereInput,
  ];
  if (shiftRecord.id) {
    conditions.unshift({
      employeeShiftIdSnapshot: shiftRecord.id,
      ...createdAtCondition,
    } as Prisma.StoreHandoverRecordWhereInput);
  }

  return conditions;
};

@Injectable()
export class HandoverShiftHandoverStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查单个班次是否已完成交班。
   * 匹配规则见 buildShiftMatchConditions。
   *
   * memo：可选的请求级缓存。同一次页面请求里，班次选择器与页面上下文
   * 会针对同一个 shift 各问一次，传入同一份 memo 可把 2 次 count 收敛为 1 次。
   */
  async isShiftHandedOver(
    storeId: number,
    shiftRecord: ShiftRecordRow | null,
    memo?: ShiftHandoverStatusMemo,
  ): Promise<boolean> {
    if (!shiftRecord?.employeeId) {
      return false;
    }

    const shiftId = shiftRecord.id;
    if (shiftId !== undefined && memo?.has(shiftId)) {
      return memo.get(shiftId) === true;
    }

    const count = await this.prisma.storeHandoverRecord.count({
      where: {
        storeId,
        fromEmployeeId: shiftRecord.employeeId,
        status: HandoverStatus.completed,
        OR: buildShiftMatchConditions(shiftRecord),
      },
    });
    const handedOver = count > 0;
    if (shiftId !== undefined) {
      memo?.set(shiftId, handedOver);
    }

    return handedOver;
  }

  /**
   * 为班次列表批量附加交班完成状态。
   * 调用方提供已加载的班次列表，本方法批量查询交班记录并逐条匹配。
   */
  async attachCompletionStatus(
    storeId: number,
    shifts: ShiftRecordRow[],
  ): Promise<Array<{ shift: ShiftRecordRow; handedOver: boolean }>> {
    if (shifts.length === 0) {
      return [];
    }

    const handedOverShiftIds = await this.loadHandedOverShiftIds(
      storeId,
      shifts,
    );

    return shifts.map((shift) => ({
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
  ): Promise<HandedOverShiftIds> {
    const shiftIds = shifts.map((s) => s.id).filter((id): id is number => !!id);

    // 计算所有 shift 时间段的整体范围，用于缩小查询范围
    const allRanges = shifts.map((s) =>
      buildShiftDateRange(s.startTime, s.endTime, s.date),
    );
    const earliestStart = allRanges.reduce(
      (min, r) => (r.startAt < min ? r.startAt : min),
      allRanges[0]?.startAt ?? new Date(0),
    );
    // 上界取各班次宽限后的最大值：合法交班的 handoverAt 恒 > endAt（规则 5）
    const latestEnd = allRanges.reduce(
      (max, r) => {
        const graceEndAt = buildShiftGraceEndAt(r);
        return graceEndAt > max ? graceEndAt : max;
      },
      allRanges[0] ? buildShiftGraceEndAt(allRanges[0]) : new Date(),
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
    const byRangeByEmployeeId = new Map<number, HandoverRangeEntry[]>();

    for (const record of handoverRecords) {
      if (record.employeeShiftIdSnapshot !== null) {
        byShiftId.add(record.employeeShiftIdSnapshot);
      } else if (record.fromEmployeeId !== null && record.handoverAt !== null) {
        // 兜底记录：只保留 handoverAt 时间戳（实际在 isShiftHandedOverFromSet 里按 shift 范围匹配）
        const entries = byRangeByEmployeeId.get(record.fromEmployeeId) ?? [];
        entries.push({
          handoverAtMs: record.handoverAt.getTime(),
          createdAtMs: record.createdAt?.getTime() ?? null,
        });
        byRangeByEmployeeId.set(record.fromEmployeeId, entries);
      }
    }

    // 分桶内按 handoverAt 升序：供 isShiftHandedOverFromSet 二分定位窗口起点
    for (const entries of byRangeByEmployeeId.values()) {
      entries.sort((left, right) => left.handoverAtMs - right.handoverAtMs);
    }

    return { byShiftId, byRangeByEmployeeId };
  }

  private isShiftHandedOverFromSet(
    shift: ShiftRecordRow,
    handedOverShiftIds: HandedOverShiftIds,
  ): boolean {
    if (!shift.employeeId) {
      return false;
    }

    // 精确匹配 shift id 快照（现代数据绝大多数命中此分支，完全跳过窗口匹配）
    if (shift.id && handedOverShiftIds.byShiftId.has(shift.id)) {
      return true;
    }

    // 兜底：检查是否有 handoverAt 落在该 shift 时间段（含宽限期）内的记录
    const entries = handedOverShiftIds.byRangeByEmployeeId.get(
      shift.employeeId,
    );
    if (!entries || entries.length === 0) {
      return false;
    }

    const shiftRange = buildShiftDateRange(
      shift.startTime,
      shift.endTime,
      shift.date,
    );
    const windowStartMs = shiftRange.startAt.getTime();
    const graceEndAtMs = buildShiftGraceEndAt(shiftRange).getTime();
    const shiftCreatedAtMs = shift.createdAt?.getTime() ?? null;

    // 二分定位到窗口起点，随后只在 [startAt, graceEnd] 窗口内线性推进：
    // 窗口通常是 0~2 条记录，复杂度由 O(记录总数) 降为 O(log M + k)。
    for (
      let index = findFirstRangeAtOrAfter(entries, windowStartMs);
      index < entries.length;
      index += 1
    ) {
      const entry = entries[index];
      if (entry.handoverAtMs > graceEndAtMs) {
        break;
      }
      if (
        shiftCreatedAtMs !== null &&
        entry.createdAtMs !== null &&
        entry.createdAtMs < shiftCreatedAtMs
      ) {
        continue;
      }
      return true;
    }

    return false;
  }
}
