import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
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
import { HandoverRecordsQueryService } from './handover-records-query.service';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  ensureMembershipContext,
  ensureMembershipStoreId,
  mapRecordToDto,
  normalizeOptionalText,
  normalizeRequiredText,
} from './handover.shared';

@Injectable()
export class HandoverRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly handoverRecordsQueryService: HandoverRecordsQueryService,
  ) {}

  async createHandoverRecord(
    user: AuthenticatedUser,
    dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const membership = ensureMembershipContext(user);
    const handoverMode =
      dto.handoverMode ??
      (membership.subjectType === 'sub_account'
        ? HandoverMode.sub_account
        : HandoverMode.self_main_account);

    this.validateCreateInput(handoverMode, dto.toEmployeeId);

    const toEmployee = dto.toEmployeeId
      ? await this.findCandidateOrThrow(storeId, dto.toEmployeeId)
      : null;

    const record = await this.prisma.storeHandoverRecord.create({
      data: {
        storeId,
        fromEmployeeId: membership.linkedEmployeeId,
        toEmployeeId: toEmployee?.id ?? null,
        fromSubAccountId:
          membership.subjectType === 'sub_account'
            ? membership.subAccountId
            : null,
        toSubAccountId: null,
        actorStaffId: membership.staffId,
        handoverMode,
        status: HandoverStatus.pending,
        note: normalizeOptionalText(dto.note, HANDOVER_NOTE_MAX_LENGTH),
      },
      include: HANDOVER_RECORD_INCLUDE,
    });

    return mapRecordToDto(record);
  }

  async completeHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const membership = ensureMembershipContext(user);
    const record = await this.handoverRecordsQueryService.findRecordOrThrow(
      storeId,
      recordId,
    );

    if (record.status !== HandoverStatus.pending) {
      throw new BadRequestException('只有待处理状态的交班记录可以完成');
    }

    if (
      record.toEmployeeId &&
      record.toEmployeeId !== membership.linkedEmployeeId
    ) {
      throw new ForbiddenException('只有指定的接收员工可以确认完成交班');
    }

    const updated = await this.prisma.storeHandoverRecord.update({
      where: { id: recordId },
      data: {
        status: HandoverStatus.completed,
        handoverAt: new Date(),
        note:
          normalizeOptionalText(dto.note, HANDOVER_NOTE_MAX_LENGTH) ??
          record.note,
        toSubAccountId: membership.subAccountId,
      },
      include: HANDOVER_RECORD_INCLUDE,
    });

    return mapRecordToDto(updated);
  }

  async cancelHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const membership = ensureMembershipContext(user);
    const record = await this.handoverRecordsQueryService.findRecordOrThrow(
      storeId,
      recordId,
    );

    if (record.status !== HandoverStatus.pending) {
      throw new BadRequestException('只有待处理状态的交班记录可以取消');
    }

    const isFromEmployee =
      record.fromEmployeeId === membership.linkedEmployeeId;
    const isOwnerOrManager =
      membership.subjectType === 'owner' || membership.role === 'MANAGER';
    if (!isFromEmployee && !isOwnerOrManager) {
      throw new ForbiddenException('只有发起人或主账号/管理员可以取消交班');
    }

    const updated = await this.prisma.storeHandoverRecord.update({
      where: { id: recordId },
      data: {
        status: HandoverStatus.cancelled,
        reason: normalizeRequiredText(dto.reason, 200, '取消原因不能为空'),
      },
      include: HANDOVER_RECORD_INCLUDE,
    });

    return mapRecordToDto(updated);
  }

  async listHandoverRecords(
    user: AuthenticatedUser,
    limit = 20,
    offset = 0,
  ): Promise<HandoverRecordListResponseDto> {
    return this.handoverRecordsQueryService.listHandoverRecords(
      ensureMembershipStoreId(user),
      limit,
      offset,
    );
  }

  async getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverRecordsQueryService.getHandoverRecord(
      ensureMembershipStoreId(user),
      recordId,
    );
  }

  async listHandoverRecordSummaries(
    user: AuthenticatedUser,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    return this.handoverRecordsQueryService.listHandoverRecordSummaries(
      ensureMembershipStoreId(user),
      query,
    );
  }

  async getHandoverCandidates(
    storeId: number,
  ): Promise<HandoverCandidateDto[]> {
    const candidates =
      await this.storeSubAccountService.listAssignableHandoverCandidates(
        storeId,
      );
    return candidates.map((candidate) => ({
      employeeId: candidate.employeeId,
      employeeName: candidate.employeeName,
      slotIndex: candidate.slotIndex,
      role: candidate.role,
    }));
  }

  async getMyPendingHandover(
    user: AuthenticatedUser,
  ): Promise<HandoverRecordListItemDto | null> {
    const membership = ensureMembershipContext(user);
    return this.handoverRecordsQueryService.getMyPendingHandover(
      membership.storeId,
      membership.linkedEmployeeId,
    );
  }

  private validateCreateInput(
    handoverMode: HandoverMode,
    toEmployeeId: number | null | undefined,
  ): void {
    if (handoverMode === HandoverMode.sub_account && !toEmployeeId) {
      throw new BadRequestException('子账号交班必须指定接收员工');
    }

    if (handoverMode === HandoverMode.self_main_account && toEmployeeId) {
      throw new BadRequestException('主账号自交班模式不需要指定接收员工');
    }
  }

  private async findCandidateOrThrow(
    storeId: number,
    employeeId: number,
  ): Promise<{ id: number; name: string }> {
    const candidates =
      await this.storeSubAccountService.listAssignableHandoverCandidates(
        storeId,
      );
    const candidate = candidates.find((item) => item.employeeId === employeeId);
    if (!candidate) {
      throw new NotFoundException('指定的接收员工不在可交班列表中');
    }
    return { id: candidate.employeeId, name: candidate.employeeName };
  }
}
