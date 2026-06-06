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
  type OwnedShiftSelection,
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
    const displayTargetEmployeeId = query.shiftType
      ? await this.handoverPageShiftViewService.resolveDisplayTargetEmployeeId(
          membership,
          query.operatorName,
        )
      : null;
    const { operationShiftRecord, shiftRecord, ownedSelection } =
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
    const receiverCandidate =
      await this.handoverPageShiftViewService.findReceiverCandidate(
        membership.storeId,
        shiftRecord,
      );
    const handoverCompletedAndNoUpcomingShift =
      await this.resolveHandoverCompletedAndNoUpcomingShift({
        membership,
        operationShiftRecord,
        requestedShiftType: query.shiftType,
        ownedShiftCompleted,
        receiverCandidate,
        shiftRecord,
        ownedSelection,
      });

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
      receiverCandidate,
      handoverCompletedAndNoUpcomingShift,
    };
  }

  private async resolveHandoverCompletedAndNoUpcomingShift(params: {
    membership: ReturnType<typeof ensureMembershipContext>;
    operationShiftRecord: ResolvedHandoverPageShiftContext['shiftRecord'];
    requestedShiftType?: EmployeeShiftType;
    ownedShiftCompleted: boolean;
    receiverCandidate: ResolvedHandoverPageShiftContext['receiverCandidate'];
    shiftRecord: ResolvedHandoverPageShiftContext['shiftRecord'];
    ownedSelection: OwnedShiftSelection;
  }): Promise<boolean> {
    const {
      membership,
      operationShiftRecord,
      requestedShiftType,
      ownedShiftCompleted,
      receiverCandidate,
      shiftRecord,
      ownedSelection,
    } = params;
    // 仅当满足以下条件时才返回 true：
    // 1. 未指定特定班次类型
    // 2. 没有接班人
    if (requestedShiftType || receiverCandidate) {
      return false;
    }

    // 判断用户班次是否已交班：
    // 情况1：有可操作的班 → 检查是否已交班
    // 情况2：没有可操作的班，但收银员原本有班（即使现在不在操作班中） → 意味着班已交班（系统切到其他班）
    // 经理没有对应班时，operationShiftRecord 可能为 null，需要检查是否需要操作
    const userHadOwnedShift = ownedSelection.ownedExactShiftRecord !== null;
    const shiftIsCompleted = operationShiftRecord
      ? ownedShiftCompleted
      : ownedSelection.isCashier || userHadOwnedShift; // 收银员模式下如果无操作班 = 班已交班或没班；经理模式下如果有班过说明已交班

    if (!shiftIsCompleted) {
      return false;
    }

    // 检查当前显示的班是否有后续班
    const targetShift = operationShiftRecord ?? shiftRecord;
    if (!targetShift || !targetShift.employeeId) {
      return false;
    }

    const nextShiftRecord =
      await this.handoverPageShiftRecordService.findNextShiftRecord(
        membership.storeId,
        targetShift,
      );

    return nextShiftRecord === null;
  }
}
