import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ConfirmHandoverRequestDto } from './dto/handover-page.dto';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';
import {
  HANDOVER_NOTE_MAX_LENGTH,
  HANDOVER_RECORD_INCLUDE,
  buildShiftDateRange,
  ensureMembershipContext,
  mapRecordToDto,
  normalizeOptionalText,
  toDisplayName,
  type HandoverRecordRow,
  type ShiftRecordRow,
} from './handover.shared';

/** 交班确认分布式锁 TTL（秒）：单次交班事务上限 + 冗余 */
const CONFIRM_HANDOVER_LOCK_TTL_SECONDS = 20;

@Injectable()
export class HandoverConfirmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
    private readonly handoverConfirmShiftService: HandoverConfirmShiftService,
    private readonly redisLockService: RedisLockService,
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
    if (!sourceShiftRecord) {
      throw new BadRequestException('当前班次不存在，请刷新页面后重试');
    }
    const sourceEmployeeId =
      sourceShiftRecord.employeeId ?? membership.linkedEmployeeId;
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

    // 分布式锁：防止多 worker 并发对同一门店+班次重复交班
    // 替代原有 pg_advisory_xact_lock（后者仅在单库单连接有效，多 worker 集群失效）
    const lockResource = this.buildConfirmLockResource(
      membership.storeId,
      sourceShiftRecord,
    );
    const lock = await this.redisLockService.acquireLock(lockResource, {
      ttlSeconds: CONFIRM_HANDOVER_LOCK_TTL_SECONDS,
    });

    if (!lock) {
      throw new ConflictException('当前班次正在进行交班操作，请稍后重试');
    }

    try {
      const record = (await this.prisma.$transaction(async (tx) => {
        await this.handoverConfirmShiftService.ensureShiftNotHandedOver(
          tx,
          membership.storeId,
          sourceShiftRecord,
          handoverAt,
        );

        return tx.storeHandoverRecord.create({
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
            shiftNameSnapshot:
              toDisplayName(sourceShiftRecord?.shiftName) ?? null,
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
        });
      })) as HandoverRecordRow;

      return mapRecordToDto(record);
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  /**
   * 构建交班确认分布式锁资源标识
   *
   * 锁粒度：门店 + 班次维度，同一班次同时只允许一个交班操作
   */
  private buildConfirmLockResource(
    storeId: number,
    shiftRecord: ShiftRecordRow,
  ): string {
    const shiftRange = buildShiftDateRange(
      shiftRecord.startTime,
      shiftRecord.endTime,
      shiftRecord.date,
    );
    const scopeSeed =
      shiftRecord.id ??
      shiftRecord.employeeId ??
      Math.floor(shiftRange.startAt.getTime() / 1000);

    return `handover:confirm:store:${storeId}:scope:${Math.abs(scopeSeed)}`;
  }
}
