import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ConfirmHandoverRequestDto,
  HandoverRecordListItemDto,
} from './dto/handover.dto';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  SHIFT_TIME_FALLBACKS,
  buildShiftDateRange,
  type ReceiverCandidate,
  ensureMembershipContext,
  mapRecordToDto,
  normalizeOptionalText,
} from './handover.shared';

@Injectable()
export class HandoverConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
  ) {}

  async confirmHandover(
    user: AuthenticatedUser,
    dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    const membership = ensureMembershipContext(user);
    const note = normalizeOptionalText(dto.note, HANDOVER_NOTE_MAX_LENGTH);
    const handoverAt = new Date(dto.handedOverAt);
    if (Number.isNaN(handoverAt.getTime())) {
      throw new BadRequestException('交班时间不正确');
    }

    const handoverMode =
      membership.subjectType === 'sub_account'
        ? HandoverMode.sub_account
        : HandoverMode.self_main_account;
    const receiverCandidate =
      handoverMode === HandoverMode.sub_account
        ? await this.findReceiverCandidate(
            membership.storeId,
            membership.linkedEmployeeId,
          )
        : null;
    const validAdditionalItems =
      await this.handoverAdditionalItemsService.resolveConfirmAdditionalItems(
        membership.storeId,
        dto.additionalItems,
      );

    await this.ensureShiftNotHandedOver(membership.storeId, membership.linkedEmployeeId, dto);

    const record = await this.prisma.storeHandoverRecord.create({
      data: {
        storeId: membership.storeId,
        fromEmployeeId: membership.linkedEmployeeId,
        toEmployeeId: receiverCandidate?.employeeId ?? null,
        fromSubAccountId: membership.subAccountId,
        toSubAccountId: receiverCandidate?.subAccountId ?? null,
        actorStaffId: membership.staffId,
        handoverMode,
        status: HandoverStatus.completed,
        handoverAt,
        note,
        ...(validAdditionalItems.length > 0
          ? {
              additionalValues: {
                create: validAdditionalItems.map((item) => ({
                  itemId: item.id,
                  value: item.value,
                })),
              },
            }
          : {}),
      },
      include: HANDOVER_RECORD_INCLUDE,
    });

    return mapRecordToDto(record);
  }

  private async ensureShiftNotHandedOver(
    storeId: number,
    employeeId: number | null,
    dto: ConfirmHandoverRequestDto,
  ): Promise<void> {
    if (!employeeId) {
      return;
    }

    const today = new Date(dto.handedOverAt);
    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(today);
    dayEnd.setHours(23, 59, 59, 999);

    const shiftRecord = await this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        employeeId,
        shiftType: dto.shiftType,
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      select: {
        startTime: true,
        endTime: true,
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });

    const fallbackTime = SHIFT_TIME_FALLBACKS[dto.shiftType];
    const shiftRange = buildShiftDateRange(
      shiftRecord?.startTime ?? fallbackTime.startTime,
      shiftRecord?.endTime ?? fallbackTime.endTime,
      today,
    );
    const exists = await this.prisma.storeHandoverRecord.count({
      where: {
        storeId,
        fromEmployeeId: employeeId,
        status: HandoverStatus.completed,
        handoverAt: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      },
    });

    if (exists > 0) {
      throw new ConflictException('当前班次已完成交班，暂不允许重复操作');
    }
  }

  private async findReceiverCandidate(
    storeId: number,
    currentEmployeeId: number | null,
  ): Promise<ReceiverCandidate | null> {
    const candidates =
      await this.storeSubAccountService.listAssignableHandoverCandidates(
        storeId,
      );
    const matched = candidates.find(
      (candidate) => candidate.employeeId !== currentEmployeeId,
    );
    return matched
      ? {
          employeeId: matched.employeeId,
          employeeName: matched.employeeName,
          subAccountId: matched.subAccountId,
        }
      : null;
  }
}
