import { BadRequestException, Injectable } from '@nestjs/common';
import { HandoverMode, HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ConfirmHandoverRequestDto } from './dto/handover-page.dto';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  ensureMembershipContext,
  mapRecordToDto,
  normalizeOptionalText,
  toDisplayName,
  type HandoverRecordRow,
} from './handover.shared';

@Injectable()
export class HandoverConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
    private readonly handoverConfirmShiftService: HandoverConfirmShiftService,
  ) {}

  async confirmHandover(
    user: AuthenticatedUser,
    dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    const membership = ensureMembershipContext(user);
    const note = normalizeOptionalText(dto.note, HANDOVER_NOTE_MAX_LENGTH);
    const handoverAt = new Date(dto.confirmedAt);
    if (Number.isNaN(handoverAt.getTime())) {
      throw new BadRequestException('交班时间不正确');
    }

    const sourceShiftRecord =
      await this.handoverConfirmShiftService.findSourceShiftRecord(
        membership.storeId,
        membership.linkedEmployeeId,
        {
          shiftType: dto.shiftType,
          handoverAt,
          shiftReferenceAt: dto.shiftReferenceAt,
          operatorName: dto.operatorName,
        },
      );
    const sourceEmployeeId =
      sourceShiftRecord?.employeeId ?? membership.linkedEmployeeId;
    const handoverMode =
      membership.subjectType === 'sub_account'
        ? HandoverMode.sub_account
        : HandoverMode.self_main_account;
    const receiverCandidate =
      handoverMode === HandoverMode.sub_account
        ? await this.handoverConfirmShiftService.resolveReceiverCandidate(
            membership.storeId,
            sourceShiftRecord,
            handoverAt,
          )
        : null;
    const validAdditionalItems =
      await this.handoverAdditionalItemsService.resolveConfirmAdditionalItems(
        membership.storeId,
        dto.additionalItems,
      );

    await this.handoverConfirmShiftService.ensureShiftNotHandedOver(
      membership.storeId,
      sourceShiftRecord,
      handoverAt,
    );

    const record = (await this.prisma.storeHandoverRecord.create({
      data: {
        storeId: membership.storeId,
        fromEmployeeId: sourceEmployeeId,
        toEmployeeId: receiverCandidate?.employeeId ?? null,
        fromSubAccountId:
          sourceEmployeeId !== null &&
          sourceEmployeeId === membership.linkedEmployeeId
            ? membership.subAccountId
            : null,
        toSubAccountId: receiverCandidate?.subAccountId ?? null,
        actorStaffId: membership.staffId,
        employeeShiftIdSnapshot: sourceShiftRecord?.id ?? null,
        fromEmployeeNameSnapshot:
          toDisplayName(sourceShiftRecord?.employeeName) ?? null,
        shiftTypeSnapshot: sourceShiftRecord?.shiftType ?? null,
        shiftNameSnapshot: toDisplayName(sourceShiftRecord?.shiftName) ?? null,
        shiftStartTimeSnapshot: sourceShiftRecord?.startTime ?? null,
        shiftEndTimeSnapshot: sourceShiftRecord?.endTime ?? null,
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
      } as Prisma.StoreHandoverRecordUncheckedCreateInput,
      include: HANDOVER_RECORD_INCLUDE,
    })) as HandoverRecordRow;

    return mapRecordToDto(record);
  }
}
