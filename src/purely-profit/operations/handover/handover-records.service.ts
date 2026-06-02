import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeShiftType,
  HandoverMode,
  HandoverStatus,
  Prisma,
} from '@prisma/client';
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
  HandoverRecordSummaryDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
} from './dto/handover.dto';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  SHIFT_TIME_FALLBACKS,
  buildRecordSummaryDto,
  buildShiftDateRange,
  type HandoverRecordRow,
  ensureMembershipContext,
  ensureMembershipStoreId,
  mapRecordToDto,
  normalizeOptionalText,
  normalizeRequiredText,
  resolveShiftLabel,
  roundMoney,
  toDisplayName,
  toMoneyNumber,
} from './handover.shared';

@Injectable()
export class HandoverRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
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
    const record = await this.findRecordOrThrow(storeId, recordId);

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
    const record = await this.findRecordOrThrow(storeId, recordId);

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
    const storeId = ensureMembershipStoreId(user);
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(offset, 0);

    const [records, total] = await Promise.all([
      this.prisma.storeHandoverRecord.findMany({
        where: { storeId },
        include: HANDOVER_RECORD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.storeHandoverRecord.count({ where: { storeId } }),
    ]);

    return {
      items: records.map((record) => mapRecordToDto(record)),
      total,
    };
  }

  async getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const record = await this.findRecordOrThrow(storeId, recordId);
    return mapRecordToDto(record);
  }

  async listHandoverRecordSummaries(
    user: AuthenticatedUser,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    const storeId = ensureMembershipStoreId(user);
    const filter = this.buildSummaryFilter(query);
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = Math.max(query.offset ?? 0, 0);
    const where: Prisma.StoreHandoverRecordWhereInput = {
      storeId,
      createdAt: {
        gte: filter.startAt,
        lte: filter.endAt,
      },
    };

    const [records, total] = await Promise.all([
      this.prisma.storeHandoverRecord.findMany({
        where,
        include: HANDOVER_RECORD_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
      }),
      this.prisma.storeHandoverRecord.count({ where }),
    ]);

    const items = await Promise.all(
      records.map((record) => this.buildRecordSummary(storeId, record)),
    );

    return {
      items,
      total,
    };
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
    if (!membership.linkedEmployeeId) {
      return null;
    }

    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: {
        storeId: membership.storeId,
        status: HandoverStatus.pending,
        OR: [
          { fromEmployeeId: membership.linkedEmployeeId },
          { toEmployeeId: membership.linkedEmployeeId },
        ],
      },
      include: HANDOVER_RECORD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return record ? mapRecordToDto(record) : null;
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

  private async buildRecordSummary(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<HandoverRecordSummaryDto> {
    const referenceDate = record.handoverAt ?? record.createdAt;
    const shiftRecord = record.fromEmployeeId
      ? await this.prisma.employeeShift.findFirst({
          where: {
            storeId,
            employeeId: record.fromEmployeeId,
            date: {
              gte: this.startOfDay(referenceDate),
              lte: this.endOfDay(referenceDate),
            },
          },
          select: {
            shiftType: true,
            shiftName: true,
            startTime: true,
            endTime: true,
          },
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
        })
      : null;

    const fallbackShiftType =
      shiftRecord?.shiftType ?? EmployeeShiftType.morning;
    const shiftRange = buildShiftDateRange(
      shiftRecord?.startTime ??
        SHIFT_TIME_FALLBACKS[fallbackShiftType].startTime,
      shiftRecord?.endTime ?? SHIFT_TIME_FALLBACKS[fallbackShiftType].endTime,
      referenceDate,
    );
    const totalRevenue = await this.countRecordRevenue(
      storeId,
      record,
      shiftRange,
    );

    return buildRecordSummaryDto({
      id: record.id,
      operatorName:
        toDisplayName(record.fromEmployee?.name) ??
        toDisplayName(record.toEmployee?.name) ??
        '未知员工',
      shiftType: shiftRecord?.shiftType ?? null,
      shiftLabel: resolveShiftLabel(
        shiftRecord?.shiftType,
        shiftRecord?.shiftName,
      ),
      startTime: shiftRecord?.startTime ?? null,
      endTime: shiftRecord?.endTime ?? null,
      totalRevenue,
      status: record.status,
      handoverAt: record.handoverAt,
      createdAt: record.createdAt,
    });
  }

  private async countRecordRevenue(
    storeId: number,
    record: HandoverRecordRow,
    shiftRange: { startAt: Date; endAt: Date },
  ): Promise<number> {
    const aggregate = await this.prisma.saleOrder.aggregate({
      where: {
        storeId,
        date: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
        ...(record.actorStaffId
          ? { operatorStaffId: record.actorStaffId }
          : {}),
      },
      _sum: { totalRevenue: true },
    });

    return roundMoney(toMoneyNumber(aggregate._sum.totalRevenue));
  }

  private buildSummaryFilter(query: HandoverRecordSummaryQueryDto): {
    startAt: Date;
    endAt: Date;
  } {
    if (query.date) {
      return this.buildDateFilter(query.date);
    }

    const now = new Date();
    const endAt = this.endOfDay(now);
    const startAt = this.startOfDay(now);
    const preset = query.preset ?? 'today';

    if (preset === '7d') {
      startAt.setDate(startAt.getDate() - 6);
      return { startAt, endAt };
    }

    if (preset === '30d') {
      startAt.setDate(startAt.getDate() - 29);
      return { startAt, endAt };
    }

    return { startAt, endAt };
  }

  private buildDateFilter(dateText: string): { startAt: Date; endAt: Date } {
    const [yearText, monthText, dayText] = dateText.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const startAt = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('日期格式不正确');
    }
    const endAt = new Date(year, month - 1, day, 23, 59, 59, 999);
    return { startAt, endAt };
  }

  private startOfDay(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  private endOfDay(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999,
    );
  }

  private async findRecordOrThrow(
    storeId: number,
    recordId: number,
  ): Promise<HandoverRecordRow> {
    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: { id: recordId, storeId },
      include: HANDOVER_RECORD_INCLUDE,
    });
    if (!record) {
      throw new NotFoundException('交班记录不存在');
    }
    return record;
  }
}
