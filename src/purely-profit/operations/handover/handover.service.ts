import { ForbiddenException, Injectable } from '@nestjs/common';
import { StaffRole, StoreSubAccountRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SpaceSessionAutoCheckoutService } from '../spaces/space-session-auto-checkout.service';
import type {
  CreateHandoverAdditionalItemDto,
  HandoverAdditionalItemDto,
  HandoverAdditionalItemListResponseDto,
  UpdateHandoverAdditionalItemDto,
} from './dto/handover-additional-items.dto';
import type {
  ConfirmHandoverRequestDto,
  HandoverPageQueryDto,
  HandoverPageResponseDto,
} from './dto/handover-page.dto';
import type {
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  CreateHandoverRecordDto,
  HandoverCandidateDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
} from './dto/handover-records.dto';

import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';
import {
  CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE,
  ensureMembershipContext,
  ensureMembershipStoreId,
} from './handover.shared';

@Injectable()
export class HandoverService {
  constructor(
    private readonly handoverPageService: HandoverPageService,
    private readonly handoverConfirmService: HandoverConfirmService,
    private readonly handoverRecordsService: HandoverRecordsService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
    private readonly spaceSessionAutoCheckoutService: SpaceSessionAutoCheckoutService,
  ) {}

  async getHandoverPage(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    await this.autoCheckoutCurrentStoreSessions(user, 'handover:page');
    return this.handoverPageService.getHandoverPage(user, query);
  }

  async confirmHandover(
    user: AuthenticatedUser,
    dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateShift(user, dto.shiftType);
    return this.handoverConfirmService.confirmHandover(user, dto);
  }

  listAdditionalItems(
    user: AuthenticatedUser,
  ): Promise<HandoverAdditionalItemListResponseDto> {
    return this.handoverAdditionalItemsService.listAdditionalItems(user);
  }

  async createAdditionalItem(
    user: AuthenticatedUser,
    dto: CreateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    await this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.createAdditionalItem(user, dto);
  }

  async updateAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    await this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.updateAdditionalItem(
      user,
      itemId,
      dto,
    );
  }

  async deleteAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
  ): Promise<void> {
    await this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.deleteAdditionalItem(
      user,
      itemId,
    );
  }

  async createHandoverRecord(
    user: AuthenticatedUser,
    dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    return this.handoverRecordsService.createHandoverRecord(user, dto);
  }

  async completeHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    return this.handoverRecordsService.completeHandoverRecord(
      user,
      recordId,
      dto,
    );
  }

  async cancelHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    return this.handoverRecordsService.cancelHandoverRecord(
      user,
      recordId,
      dto,
    );
  }

  async listHandoverRecords(
    user: AuthenticatedUser,
    limit?: number,
    offset?: number,
  ): Promise<HandoverRecordListResponseDto> {
    await this.autoCheckoutCurrentStoreSessions(user, 'handover:records');
    return this.handoverRecordsService.listHandoverRecords(user, limit, offset);
  }

  async getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    await this.autoCheckoutCurrentStoreSessions(user, 'handover:record-detail');
    return this.handoverRecordsService.getHandoverRecord(user, recordId);
  }

  async listHandoverRecordSummaries(
    user: AuthenticatedUser,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    await this.autoCheckoutCurrentStoreSessions(
      user,
      'handover:record-summaries',
    );
    return this.handoverRecordsService.listHandoverRecordSummaries(user, query);
  }

  getHandoverCandidates(storeId: number): Promise<HandoverCandidateDto[]> {
    return this.handoverRecordsService.getHandoverCandidates(storeId);
  }

  async getMyPendingHandover(
    user: AuthenticatedUser,
  ): Promise<HandoverRecordListItemDto | null> {
    await this.autoCheckoutCurrentStoreSessions(user, 'handover:my-pending');
    return this.handoverRecordsService.getMyPendingHandover(user);
  }

  private async ensureUserCanOperateCurrentShift(
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.ensureUserCanOperateShift(user);
  }

  private async autoCheckoutCurrentStoreSessions(
    user: AuthenticatedUser,
    trigger: string,
  ): Promise<void> {
    await this.spaceSessionAutoCheckoutService.autoCheckoutExpiredCountdownSessions(
      user,
      ensureMembershipStoreId(user),
      Date.now(),
      trigger,
    );
  }

  private async ensureUserCanManageAdditionalItems(
    user: AuthenticatedUser,
  ): Promise<void> {
    const membership = ensureMembershipContext(user);
    const isManager =
      membership.role === StaffRole.MANAGER ||
      membership.subAccountRole === StoreSubAccountRole.manager;

    if (membership.subjectType === 'owner' || isManager) {
      return;
    }

    await this.ensureUserCanOperateCurrentShift(user);
  }

  private async ensureUserCanOperateShift(
    user: AuthenticatedUser,
    shiftType?: HandoverPageQueryDto['shiftType'],
  ): Promise<void> {
    ensureMembershipContext(user);

    const page = await this.handoverPageService.getHandoverPage(user, {
      ...(shiftType ? { shiftType } : {}),
    });
    if (!page.canOperate) {
      throw new ForbiddenException(
        page.operationBlockedReason ?? CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE,
      );
    }

    // 页面读取允许自动切到下一班次，但写接口必须严格命中请求的班次，避免重复交旧班。
    if (shiftType && page.selectedShiftType !== shiftType) {
      throw new ForbiddenException('当前班次已完成交班，暂不允许重复操作');
    }
  }
}
