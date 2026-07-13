import {
  BadRequestException,
  ConflictException,
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
  buildShiftDateRange,
  ensureMembershipContext,
  ensureMembershipStoreId,
  isManagerMembership,
  mapRecordToDto,
  normalizeOptionalText,
  normalizeRequiredText,
} from './handover.shared';

/**
 * 交班宽限小时数：与 handover-confirm-shift.service.ts 的 HANDOVER_SHIFT_GRACE_HOURS 对齐。
 * 班次结束后该时间窗口内的交班记录仍视为合法，用于时间窗口查重上界。
 */
const HANDOVER_SHIFT_GRACE_HOURS = 4;

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

    const isOwnerOrManager =
      membership.subjectType === 'owner' || isManagerMembership(membership);
    const isFromEmployee =
      record.fromEmployeeId === membership.linkedEmployeeId;

    if (record.toEmployeeId) {
      if (record.toEmployeeId !== membership.linkedEmployeeId) {
        throw new ForbiddenException('只有指定的接收员工可以确认完成交班');
      }
    } else if (!isFromEmployee && !isOwnerOrManager) {
      throw new ForbiddenException('只有发起人或主账号/管理员可以确认完成交班');
    }

    // B4 fix：重复交班拦截 —— 仅拦截同一班次的重复交班，
    // 不再按"当天任意已完成记录"拦截（多班次场景下会误拦其它班次的交班）。
    // 策略：优先用 employeeShiftIdSnapshot 精确匹配（confirm 路径总是写入快照），
    // 时间窗口作为 null-snapshot 记录的降级（上界放宽到 endAt + grace，
    // 因为规则 5 要求 handoverAt > endAt，合法交班必然落在 endAt 之后）。
    if (record.fromEmployeeId && record.createdAt) {
      // 1. 定位 pending 记录所属班次：以 createdAt 为时间基准，找到当时正在进行的班次
      const employeeShifts = await this.prisma.employeeShift.findMany({
        where: {
          storeId,
          employeeId: record.fromEmployeeId,
          date: { lte: record.createdAt },
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          date: true,
        },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        take: 30,
      });

      const ownedShift = employeeShifts.find((s) => {
        const range = buildShiftDateRange(s.startTime, s.endTime, s.date);
        const graceEnd = new Date(range.endAt);
        graceEnd.setHours(graceEnd.getHours() + HANDOVER_SHIFT_GRACE_HOURS);
        return (
          record.createdAt!.getTime() >= range.startAt.getTime() &&
          record.createdAt!.getTime() <= graceEnd.getTime()
        );
      });

      if (ownedShift) {
        // 2. 检查该班次是否已有 completed 记录
        const shiftRange = buildShiftDateRange(
          ownedShift.startTime,
          ownedShift.endTime,
          ownedShift.date,
        );
        const graceEndAt = new Date(shiftRange.endAt);
        graceEndAt.setHours(graceEndAt.getHours() + HANDOVER_SHIFT_GRACE_HOURS);
        const existingCompleted = await this.prisma.storeHandoverRecord.count({
          where: {
            storeId,
            fromEmployeeId: record.fromEmployeeId,
            status: HandoverStatus.completed,
            OR: [
              // 精确匹配：confirm 路径写入的 employeeShiftIdSnapshot
              { employeeShiftIdSnapshot: ownedShift.id },
              // 降级兜底：无快照的旧记录，按班次时段 + grace 窗口匹配
              {
                employeeShiftIdSnapshot: null,
                handoverAt: {
                  gte: shiftRange.startAt,
                  lte: graceEndAt,
                },
              },
            ],
          },
        });
        if (existingCompleted > 0) {
          throw new ConflictException('当前班次已完成交班，暂不允许重复操作');
        }
      }
      // 若找不到 ownedShift（极端边界：pending 创建于所有班次时间窗口之外），
      // 跳过拦截。这是保守策略：宁可不拦也不误拦。
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
      membership.subjectType === 'owner' || isManagerMembership(membership);
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
