import { Injectable } from '@nestjs/common';
import { toOptionalMediaText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  toDisplayName,
  type HandoverRecordRow,
  type RecordShiftSnapshot,
} from './handover.shared';
import type { BatchPreloadedData } from './handover-record-batch-preloader.service';

export type RecordOperatorProfile = {
  linkedStaffId: number | null;
  avatar: string | null;
};

@Injectable()
export class HandoverRecordOperatorProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** 从预加载数据中解析操作员档案 */
  resolveFromPreloaded(
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

  /** 单条查询操作员档案（linkedStaffId + avatar） */
  async resolveSingle(
    record: HandoverRecordRow,
    shiftRecord: RecordShiftSnapshot | null,
  ): Promise<RecordOperatorProfile> {
    const employeeId = shiftRecord?.employeeId ?? record.fromEmployeeId;
    if (!employeeId) {
      return { linkedStaffId: null, avatar: null };
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

  /** 解析操作员显示名称（纯函数，无 DB 依赖） */
  static resolveOperatorName(
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
}
