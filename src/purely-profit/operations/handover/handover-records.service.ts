import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus, Prisma } from '@prisma/client';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
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
import type { ShiftRecordRow } from './handover.types';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  buildShiftDateRange,
  buildShiftGraceEndAt,
  ensureMembershipContext,
  ensureMembershipStoreId,
  isManagerMembership,
  mapRecordToDto,
  normalizeOptionalText,
  normalizeRequiredText,
  toDisplayName,
} from './handover.shared';

/** 完成/取消交班记录时用于定位所属班次的回溯条数上限 */
const OWNED_SHIFT_LOOKUP_TAKE = 30;

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

    // 定位班次、查重与状态变更必须在同一事务内完成，
    // 否则并发 complete / complete+cancel 会出现 TOCTOU 双写（后写覆盖先写）。
    const completedAt = new Date();
    const note =
      normalizeOptionalText(dto.note, HANDOVER_NOTE_MAX_LENGTH) ?? record.note;

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // B4 fix：重复交班拦截 —— 仅拦截同一班次的重复交班，
        // 不再按"当天任意已完成记录"拦截（多班次场景下会误拦其它班次的交班）。
        // 策略：优先用 employeeShiftIdSnapshot 精确匹配（confirm 路径总是写入快照），
        // 时间窗口作为 null-snapshot 记录的降级（上界放宽到 endAt + grace，
        // 因为规则 5 要求 handoverAt > endAt，合法交班必然落在 endAt 之后）。
        const ownedShift =
          record.fromEmployeeId && record.createdAt
            ? await this.findOwnedShift(
                tx,
                storeId,
                record.fromEmployeeId,
                record.createdAt,
              )
            : null;

        if (ownedShift) {
          const shiftRange = buildShiftDateRange(
            ownedShift.startTime,
            ownedShift.endTime,
            ownedShift.date,
          );
          const existingCompleted = await tx.storeHandoverRecord.count({
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
                    lte: buildShiftGraceEndAt(shiftRange),
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

        // 条件更新：只有仍处于 pending 才生效。并发场景下后到的请求
        // count === 0，直接失败，避免 complete/cancel 互相覆盖。
        const result = await tx.storeHandoverRecord.updateMany({
          where: { id: recordId, storeId, status: HandoverStatus.pending },
          data: {
            status: HandoverStatus.completed,
            handoverAt: completedAt,
            note,
            toSubAccountId: membership.subAccountId,
            // 补齐班次快照：与 confirm 路径保持一致，
            // 否则本记录对 isShiftHandedOver / ensureShiftNotHandedOver 不可见，
            // 同一班次会被再次交班。
            ...(ownedShift
              ? {
                  employeeShiftIdSnapshot: ownedShift.id ?? null,
                  fromEmployeeNameSnapshot:
                    toDisplayName(ownedShift.employeeName) ?? null,
                  shiftTypeSnapshot: ownedShift.shiftType ?? null,
                  shiftNameSnapshot:
                    toDisplayName(ownedShift.shiftName) ?? null,
                  shiftStartTimeSnapshot: ownedShift.startTime ?? null,
                  shiftEndTimeSnapshot: ownedShift.endTime ?? null,
                }
              : {}),
          },
        });

        if (result.count === 0) {
          throw new ConflictException('交班记录状态已变更，请刷新页面后重试');
        }

        return tx.storeHandoverRecord.findUniqueOrThrow({
          where: { id: recordId },
          include: HANDOVER_RECORD_INCLUDE,
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return mapRecordToDto(updated);
  }

  /**
   * 定位 pending 记录所属班次：以记录 createdAt 为时间基准，找到当时正在进行的班次。
   * 上界放宽到 endAt + 宽限，覆盖"班次结束后补建交班记录"的场景。
   */
  private async findOwnedShift(
    tx: Prisma.TransactionClient,
    storeId: number,
    employeeId: number,
    createdAt: Date,
  ): Promise<ShiftRecordRow | null> {
    const employeeShifts = await tx.employeeShift.findMany({
      where: {
        storeId,
        employeeId,
        date: { lte: createdAt },
      },
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        shiftType: true,
        shiftName: true,
        startTime: true,
        endTime: true,
        date: true,
      },
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      take: OWNED_SHIFT_LOOKUP_TAKE,
    });

    return (
      employeeShifts.find((shift) => {
        const range = buildShiftDateRange(
          shift.startTime,
          shift.endTime,
          shift.date,
        );
        return (
          createdAt.getTime() >= range.startAt.getTime() &&
          createdAt.getTime() <= buildShiftGraceEndAt(range).getTime()
        );
      }) ?? null
    );
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

    // 条件更新：只有仍处于 pending 才生效，避免与并发的 complete/cancel 互相覆盖
    const result = await this.prisma.storeHandoverRecord.updateMany({
      where: { id: recordId, storeId, status: HandoverStatus.pending },
      data: {
        status: HandoverStatus.cancelled,
        reason: normalizeRequiredText(dto.reason, 200, '取消原因不能为空'),
      },
    });

    if (result.count === 0) {
      throw new ConflictException('交班记录状态已变更，请刷新页面后重试');
    }

    const updated = await this.prisma.storeHandoverRecord.findUniqueOrThrow({
      where: { id: recordId },
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
