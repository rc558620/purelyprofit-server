import { Injectable } from '@nestjs/common';
import { toOptionalMediaText } from '../../commerce/commerce.utils';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import type {
  DisplayOperatorInfo,
  MembershipContext,
  ReceiverCandidate,
  ShiftRecordRow,
} from './handover.shared';
import { isManagerMembership, toDisplayName } from './handover.shared';

@Injectable()
export class HandoverPageShiftViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly handoverPageShiftRecordService: HandoverPageShiftRecordService,
  ) {}

  async resolveDisplayTargetEmployeeId(
    membership: MembershipContext,
    operatorName?: string,
  ): Promise<number | null> {
    const normalizedOperatorName = toDisplayName(operatorName);
    if (!normalizedOperatorName) {
      return null;
    }

    const targetEmployeeId =
      await this.handoverPageShiftRecordService.findEmployeeIdByOperatorName(
        membership.storeId,
        normalizedOperatorName,
      );
    if (targetEmployeeId === null) {
      return null;
    }

    if (
      membership.subjectType === 'owner' ||
      isManagerMembership(membership) ||
      membership.linkedEmployeeId === targetEmployeeId
    ) {
      return targetEmployeeId;
    }

    return null;
  }

  async resolveDisplayOperatorInfo(
    membership: MembershipContext,
    shiftEmployeeId: number | null,
  ): Promise<DisplayOperatorInfo> {
    const employeeId = shiftEmployeeId ?? membership.linkedEmployeeId;
    if (!employeeId) {
      return {
        name: null,
        staffId: membership.staffId,
      };
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        name: true,
        avatar: true,
        linkedStaffId: true,
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
    const resolvedAvatar =
      toOptionalMediaText(employee?.avatar) ??
      toOptionalMediaText(employee?.linkedStaff?.user?.avatar);
    const staffId =
      shiftEmployeeId === null ||
      (membership.linkedEmployeeId !== null &&
        employeeId === membership.linkedEmployeeId)
        ? membership.staffId
        : (employee?.linkedStaffId ?? null);

    return {
      name: toDisplayName(employee?.name),
      ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
      staffId,
    };
  }

  async findReceiverCandidate(
    storeId: number,
    currentShiftRecord: ShiftRecordRow | null,
  ): Promise<ReceiverCandidate | null> {
    const nextShiftRecord =
      await this.handoverPageShiftRecordService.findNextShiftRecord(
        storeId,
        currentShiftRecord,
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
}
