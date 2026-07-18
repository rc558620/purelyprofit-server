import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { HandoverPageQueryDto } from './dto/handover-page.dto';
import { buildPageShiftInfo } from './handover-page-shift-info';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
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
    private readonly handoverShiftHandoverStatusService: HandoverShiftHandoverStatusService,
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
      await this.handoverShiftHandoverStatusService.isShiftHandedOver(
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
    ownedSelection: OwnedShiftSelection;
  }): Promise<boolean> {
    const {
      membership,
      operationShiftRecord,
      requestedShiftType,
      ownedShiftCompleted,
      receiverCandidate,
      ownedSelection,
    } = params;
    // 如果用户完全没有个人排班（既无可操作班次，也无自有班次），
    // 且用户未关联员工（如新注册用户），不应展示全店其他员工的班次数据，
    // 直接视为"无有效班次"，避免无排班用户错误看到他人班次指标。
    // 注：已关联员工但无当前班次的收银员/员工仍需展示全店视图（合法监控场景）。
    if (
      !operationShiftRecord &&
      !ownedSelection.ownedExactShiftRecord &&
      !membership.linkedEmployeeId
    ) {
      return true;
    }

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
      : ownedSelection.isCashier || userHadOwnedShift;

    // 如果有可操作的班次且尚未交班，直接返回 false
    if (operationShiftRecord && !shiftIsCompleted) {
      return false;
    }

    // 确定用于查询后续班次的基准班次
    let targetShift = operationShiftRecord;

    // 收银员的可操作班次为空时，回退到该收银员自己的最后一个班次作为基准，
    // 避免使用 shiftRecord（可能是全店当前班次）导致基准偏移到别人的末班，
    // 从而漏判后续全店班次。
    if (!targetShift && ownedSelection.isCashier) {
      targetShift =
        await this.handoverPageShiftRecordService.findLastShiftRecord(
          membership.storeId,
          membership.linkedEmployeeId,
        );
    }

    // 当 operationShiftRecord 和收银员自己的最后班次都为 null 时
    // （所有班次都已交班且找不到任何班次），
    // 回退查询今日最后一个班次（不限是否已交班）来判断是否有后续班次。
    // 收银员只查自己的班次；老板/经理查全店。
    if (!targetShift) {
      const lookupEmployeeId = ownedSelection.isCashier
        ? membership.linkedEmployeeId
        : null;
      if (ownedSelection.isCashier && !lookupEmployeeId) {
        return false;
      }
      targetShift =
        await this.handoverPageShiftRecordService.findLastShiftRecord(
          membership.storeId,
          lookupEmployeeId,
        );
      if (!targetShift) {
        return false;
      }
    }

    if (!targetShift.employeeId) {
      return false;
    }

    // 收银员查自己的后续班次；老板/经理查全店。
    const nextLookupEmployeeId = ownedSelection.isCashier
      ? membership.linkedEmployeeId
      : null;
    const nextShiftRecord =
      await this.handoverPageShiftRecordService.findNextShiftRecord(
        membership.storeId,
        targetShift,
        nextLookupEmployeeId,
      );

    return nextShiftRecord === null;
  }
}
