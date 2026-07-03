import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import { toOptionalMediaText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  endOfDay,
  startOfDay,
  type HandoverRecordRow,
  type RecordShiftSnapshot,
} from './handover.shared';

/** 批量预加载数据，用于 resolveRecordViewContextBatch */
export type BatchPreloadedData = {
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
export class HandoverRecordBatchPreloaderService {
  constructor(private readonly prisma: PrismaService) {}

  async preload(
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
            where: { id: { in: Array.from(employeeIdSet) }, deletedAt: null },
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
}
