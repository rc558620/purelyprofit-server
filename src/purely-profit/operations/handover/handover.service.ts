import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  ConfirmHandoverRequestDto,
  CreateHandoverAdditionalItemDto,
  CreateHandoverRecordDto,
  HandoverAdditionalItemDto,
  HandoverAdditionalItemListResponseDto,
  HandoverCandidateDto,
  HandoverPageQueryDto,
  HandoverPageResponseDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
  UpdateHandoverAdditionalItemDto,
} from './dto/handover.dto';

import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';

@Injectable()
export class HandoverService {
  constructor(
    private readonly handoverPageService: HandoverPageService,
    private readonly handoverConfirmService: HandoverConfirmService,
    private readonly handoverRecordsService: HandoverRecordsService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
  ) {}

  getHandoverPage(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    return this.handoverPageService.getHandoverPage(user, query);
  }

  confirmHandover(
    user: AuthenticatedUser,
    dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverConfirmService.confirmHandover(user, dto);
  }

  listAdditionalItems(
    user: AuthenticatedUser,
  ): Promise<HandoverAdditionalItemListResponseDto> {
    return this.handoverAdditionalItemsService.listAdditionalItems(user);
  }

  createAdditionalItem(
    user: AuthenticatedUser,
    dto: CreateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    return this.handoverAdditionalItemsService.createAdditionalItem(user, dto);
  }

  updateAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    return this.handoverAdditionalItemsService.updateAdditionalItem(
      user,
      itemId,
      dto,
    );
  }

  deleteAdditionalItem(user: AuthenticatedUser, itemId: number): Promise<void> {
    return this.handoverAdditionalItemsService.deleteAdditionalItem(
      user,
      itemId,
    );
  }

  createHandoverRecord(
    user: AuthenticatedUser,
    dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverRecordsService.createHandoverRecord(user, dto);
  }

  completeHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverRecordsService.completeHandoverRecord(
      user,
      recordId,
      dto,
    );
  }

  cancelHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverRecordsService.cancelHandoverRecord(
      user,
      recordId,
      dto,
    );
  }

  listHandoverRecords(
    user: AuthenticatedUser,
    limit?: number,
    offset?: number,
  ): Promise<HandoverRecordListResponseDto> {
    return this.handoverRecordsService.listHandoverRecords(user, limit, offset);
  }

  getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverRecordsService.getHandoverRecord(user, recordId);
  }

  listHandoverRecordSummaries(
    user: AuthenticatedUser,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    return this.handoverRecordsService.listHandoverRecordSummaries(user, query);
  }

  getHandoverCandidates(storeId: number): Promise<HandoverCandidateDto[]> {
    return this.handoverRecordsService.getHandoverCandidates(storeId);
  }

  getMyPendingHandover(
    user: AuthenticatedUser,
  ): Promise<HandoverRecordListItemDto | null> {
    return this.handoverRecordsService.getMyPendingHandover(user);
  }
}
