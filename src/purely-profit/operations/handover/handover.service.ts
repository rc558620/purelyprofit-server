import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import type {
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  CreateHandoverRecordDto,
  HandoverCandidateDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
} from './dto/handover.dto';
import { HandoverModeDto, HandoverStatusDto } from './dto/handover.dto';

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async createHandoverRecord(
    user: AuthenticatedUser,
    dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = this.ensureMembership(user);
    const membership = user.currentMembership!;

    // 确定交班模式
    const handoverMode =
      dto.handoverMode ??
      (membership.subjectType === 'sub_account'
        ? HandoverMode.sub_account
        : HandoverMode.self_main_account);

    // 子账号交班必须指定接收人
    if (handoverMode === HandoverMode.sub_account && !dto.toEmployeeId) {
      throw new BadRequestException('子账号交班必须指定接收员工');
    }

    // 主账号自交班模式：标记自己完成工作，不需要接收人
    if (handoverMode === HandoverMode.self_main_account && dto.toEmployeeId) {
      throw new BadRequestException('主账号自交班模式不需要指定接收员工');
    }

    // 验证接收人是否有效
    let toEmployee: { id: number; name: string } | null = null;
    if (dto.toEmployeeId) {
      const candidates = await this.getHandoverCandidates(storeId);
      const candidate = candidates.find(
        (c) => c.employeeId === dto.toEmployeeId,
      );
      if (!candidate) {
        throw new NotFoundException('指定的接收员工不在可交班列表中');
      }
      toEmployee = { id: candidate.employeeId, name: candidate.employeeName };
    }

    // 获取发起人的员工信息
    const fromEmployeeId = membership.linkedEmployeeId;
    let fromSubAccountId: number | null = null;

    if (membership.subjectType === 'sub_account' && membership.subAccountId) {
      fromSubAccountId = membership.subAccountId;
    }

    const record = await this.prisma.storeHandoverRecord.create({
      data: {
        storeId,
        fromEmployeeId,
        toEmployeeId: toEmployee?.id ?? null,
        fromSubAccountId,
        toSubAccountId: null, // 完成交班时填充
        actorStaffId: membership.staffId,
        handoverMode,
        status: HandoverStatus.pending,
        note: dto.note?.trim() ?? null,
      },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
      },
    });

    return this.mapRecordToDto(record);
  }

  async completeHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = this.ensureMembership(user);
    const membership = user.currentMembership!;

    const record = await this.findRecordOrThrow(storeId, recordId);

    if (record.status !== HandoverStatus.pending) {
      throw new BadRequestException('只有待处理状态的交班记录可以完成');
    }

    // 验证操作权限：只有接收人可以确认完成
    if (
      record.toEmployeeId &&
      record.toEmployeeId !== membership.linkedEmployeeId
    ) {
      throw new ForbiddenException('只有指定的接收员工可以确认完成交班');
    }

    const toSubAccountId = membership.subAccountId;

    const updated = await this.prisma.storeHandoverRecord.update({
      where: { id: recordId },
      data: {
        status: HandoverStatus.completed,
        handoverAt: new Date(),
        note: dto.note?.trim() ?? record.note,
        toSubAccountId,
      },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
      },
    });

    return this.mapRecordToDto(updated);
  }

  async cancelHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = this.ensureMembership(user);
    const membership = user.currentMembership!;

    const record = await this.findRecordOrThrow(storeId, recordId);

    if (record.status !== HandoverStatus.pending) {
      throw new BadRequestException('只有待处理状态的交班记录可以取消');
    }

    // 验证操作权限：发起人或主账号可以取消
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
        reason: dto.reason?.trim(),
      },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
      },
    });

    return this.mapRecordToDto(updated);
  }

  async listHandoverRecords(
    user: AuthenticatedUser,
    limit = 20,
    offset = 0,
  ): Promise<HandoverRecordListResponseDto> {
    const storeId = this.ensureMembership(user);

    const [records, total] = await Promise.all([
      this.prisma.storeHandoverRecord.findMany({
        where: { storeId },
        include: {
          fromEmployee: { select: { id: true, name: true } },
          toEmployee: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.storeHandoverRecord.count({ where: { storeId } }),
    ]);

    return {
      items: records.map((r) => this.mapRecordToDto(r)),
      total,
    };
  }

  async getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    const storeId = this.ensureMembership(user);
    const record = await this.findRecordOrThrow(storeId, recordId);
    return this.mapRecordToDto(record);
  }

  async getHandoverCandidates(
    storeId: number,
  ): Promise<HandoverCandidateDto[]> {
    const candidates =
      await this.storeSubAccountService.listAssignableHandoverCandidates(
        storeId,
      );

    return candidates.map((c) => ({
      employeeId: c.employeeId,
      employeeName: c.employeeName,
      slotIndex: c.slotIndex,
      role: c.role,
    }));
  }

  async getMyPendingHandover(
    user: AuthenticatedUser,
  ): Promise<HandoverRecordListItemDto | null> {
    const storeId = this.ensureMembership(user);
    const employeeId = user.currentMembership!.linkedEmployeeId;

    if (!employeeId) {
      return null;
    }

    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: {
        storeId,
        status: HandoverStatus.pending,
        OR: [{ fromEmployeeId: employeeId }, { toEmployeeId: employeeId }],
      },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return record ? this.mapRecordToDto(record) : null;
  }

  private ensureMembership(user: AuthenticatedUser): number {
    if (!user.currentMembership) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }
    return user.currentMembership.storeId;
  }

  private async findRecordOrThrow(storeId: number, recordId: number) {
    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: { id: recordId, storeId },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
      },
    });

    if (!record) {
      throw new NotFoundException('交班记录不存在');
    }

    return record;
  }

  private mapRecordToDto(record: {
    id: number;
    handoverMode: HandoverMode;
    status: HandoverStatus;
    fromEmployeeId: number | null;
    fromEmployee: { id: number; name: string } | null;
    toEmployeeId: number | null;
    toEmployee: { id: number; name: string } | null;
    note: string | null;
    reason: string | null;
    handoverAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): HandoverRecordListItemDto {
    return {
      id: record.id,
      handoverMode: record.handoverMode as unknown as HandoverModeDto,
      status: record.status as unknown as HandoverStatusDto,
      fromEmployeeId: record.fromEmployeeId,
      fromEmployeeName: record.fromEmployee?.name ?? null,
      toEmployeeId: record.toEmployeeId,
      toEmployeeName: record.toEmployee?.name ?? null,
      note: record.note,
      reason: record.reason,
      handoverAt: record.handoverAt?.getTime() ?? null,
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };
  }
}
