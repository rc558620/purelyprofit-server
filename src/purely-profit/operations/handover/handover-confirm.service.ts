import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus, Prisma } from '@prisma/client';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import {
  RedisLockService,
  type DistributedLock,
} from '../../../redis/redis-lock.service';
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
import {
  buildHandoverAdvisoryLockKeys,
  buildHandoverShiftLockResource,
} from './handover.utils';

/** 交班确认分布式锁 TTL（秒）：单次交班事务上限 + 冗余 */
const CONFIRM_HANDOVER_LOCK_TTL_SECONDS = 20;

@Injectable()
export class HandoverConfirmService {
  private readonly logger = new Logger(HandoverConfirmService.name);

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
    // 客户端声明的交班时刻：仅用于合法性校验与班次匹配，不作为落库口径。
    const handoverAt = new Date(dto.confirmedAt);
    if (Number.isNaN(handoverAt.getTime())) {
      throw new BadRequestException('交班时间不正确');
    }
    // 服务器权威交班时刻：营收统计起点（findShiftInitializedStartAt）与
    // 附加项最近填写值排序都依赖 handoverAt 落库值，必须由服务器时钟决定，
    // 避免设备时钟错误或伪造请求把统计切分点推到过去造成营收重复/漏算。
    const serverHandoverAt = new Date();

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

    // ── BUG-2 / O-1 修复 ──
    // 交班时间必须晚于班次结束时间（规则5：须到达班次结束时间之后才能交班），
    // 且不得晚于当前服务器时间（O-1：禁止未来时间交班）。
    // 允许极小时钟偏差，避免客户端与服务器时钟毫秒级差异导致误拒。
    const shiftEndAt = buildShiftDateRange(
      sourceShiftRecord.startTime,
      sourceShiftRecord.endTime,
      sourceShiftRecord.date,
    ).endAt;
    const nowMillis = Date.now();
    const MAX_CLOCK_SKEW_MS = 5_000;
    if (handoverAt.getTime() - nowMillis > MAX_CLOCK_SKEW_MS) {
      throw new BadRequestException('交班时间不能晚于当前时间');
    }
    if (handoverAt.getTime() <= shiftEndAt.getTime()) {
      throw new BadRequestException('未到交班时间，请在班次结束后交班');
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

    // 分布式锁：防止多 worker 并发对同一门店+班次重复交班。
    // Redis 锁只承担快速失败；真正的互斥由事务级 pg_advisory_xact_lock 保证：
    // 它与 Redis TTL 无关、事务结束自动释放，且 Redis 不可用降级时仍能与其它
    // 实例（无论是否降级）在同一数据库上串行化，避免两套锁机制互不互通。
    const lockResource = this.buildConfirmLockResource(
      membership.storeId,
      sourceShiftRecord,
    );
    let lock: DistributedLock | null = null;
    let redisUnavailable = false;
    try {
      lock = await this.redisLockService.acquireLock(lockResource, {
        ttlSeconds: CONFIRM_HANDOVER_LOCK_TTL_SECONDS,
      });
    } catch (error) {
      redisUnavailable = true;
      this.logger.warn(
        `[handover] redis_lock_unavailable fallback=pg_advisory_xact_lock resource=${lockResource} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
      );
    }

    if (!lock && !redisUnavailable) {
      throw new ConflictException('当前班次正在进行交班操作，请稍后重试');
    }

    try {
      const record = (await this.prisma.$transaction(
        async (tx) => {
          // 事务级互斥：与 Redis 锁 TTL 无关，事务结束自动释放；
          // Redis 不可用降级时仍能与其它实例在同一数据库上串行化。
          const [key1, key2] = buildHandoverAdvisoryLockKeys(lockResource);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}, ${key2})`;

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
              handoverAt: serverHandoverAt,
              note,
              ...(validAdditionalItems.length > 0
                ? {
                    additionalValues: {
                      create: validAdditionalItems.map((item) => ({
                        itemId: item.id,
                        itemNameSnapshot: item.name,
                        value: item.value,
                      })),
                    },
                  }
                : {}),
            } as Prisma.StoreHandoverRecordUncheckedCreateInput,
            include: HANDOVER_RECORD_INCLUDE,
          });
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      )) as HandoverRecordRow;

      return mapRecordToDto(record);
    } finally {
      if (lock) {
        await this.redisLockService.releaseLock(lock);
      }
    }
  }

  /**
   * 构建交班写入链路共用的锁资源标识。
   * 锁粒度：门店 + 班次维度；必须与 completeHandoverRecord 路径生成同一标识。
   */
  private buildConfirmLockResource(
    storeId: number,
    shiftRecord: ShiftRecordRow,
  ): string {
    if (shiftRecord.id) {
      return buildHandoverShiftLockResource(storeId, shiftRecord.id);
    }

    const shiftRange = buildShiftDateRange(
      shiftRecord.startTime,
      shiftRecord.endTime,
      shiftRecord.date,
    );
    const scopeSeed =
      shiftRecord.employeeId ?? Math.floor(shiftRange.startAt.getTime() / 1000);

    return buildHandoverShiftLockResource(storeId, scopeSeed);
  }
}
