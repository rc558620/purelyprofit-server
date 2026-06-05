import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { HandoverPageQueryDto } from './dto/handover-page.dto';
import { buildPageShiftInfo } from './handover-page.shared';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import { HandoverPageShiftSelectorService } from './handover-page-shift-selector.service';
import { HandoverPageShiftViewService } from './handover-page-shift-view.service';
import {
  ensureMembershipContext,
  resolveHandoverOperationAccess,
  type ResolvedHandoverPageShiftContext,
} from './handover.shared';

@Injectable()
export class HandoverPageShiftService {
  constructor(
    private readonly handoverPageShiftRecordService: HandoverPageShiftRecordService,
    private readonly handoverPageShiftSelectorService: HandoverPageShiftSelectorService,
    private readonly handoverPageShiftViewService: HandoverPageShiftViewService,
  ) {}

  async resolvePageShiftContext(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<ResolvedHandoverPageShiftContext> {
    const membership = ensureMembershipContext(user);
    const displayTargetEmployeeId =
      await this.handoverPageShiftViewService.resolveDisplayTargetEmployeeId(
        membership,
        query.operatorName,
      );
    const { operationShiftRecord, shiftRecord } =
      await this.handoverPageShiftSelectorService.resolveShiftSelection({
        membership,
        requestedShiftType: query.shiftType,
        displayTargetEmployeeId,
      });
    const shiftType =
      shiftRecord?.shiftType ?? query.shiftType ?? EmployeeShiftType.morning;
    const ownedShiftCompleted =
      await this.handoverPageShiftRecordService.isShiftHandedOver(
        membership.storeId,
        operationShiftRecord,
      );
    const operationAccess = resolveHandoverOperationAccess({
      membership,
      ownedShiftRecord: operationShiftRecord,
      ownedShiftCompleted,
      requestedShiftType: query.shiftType,
    });
    const displayOperatorInfo =
      await this.handoverPageShiftViewService.resolveDisplayOperatorInfo(
        membership,
        shiftRecord?.employeeId ?? displayTargetEmployeeId ?? null,
      );

    return {
      membership,
      shiftRecord,
      shiftInfo: buildPageShiftInfo({
        userName: user.name,
        shiftRecord,
        shiftType,
        displayOperatorInfo,
        requestedOperatorName: query.operatorName,
      }),
      operationAccess,
      displayOperatorStaffId: displayOperatorInfo.staffId,
      receiverCandidate:
        await this.handoverPageShiftViewService.findReceiverCandidate(
          membership.storeId,
          shiftRecord,
        ),
    };
  }
}
