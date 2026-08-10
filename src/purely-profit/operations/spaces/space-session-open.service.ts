import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { bindVoucherOnOpen } from './space-session-voucher.shared';
import type {
  OpenSpaceSessionDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { normalizeOpenSessionPayload } from './space-session-payload.shared';
import { ensureOpenSessionPayload } from './space-session-open-validation.shared';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type { SpaceBillingModeValue } from './spaces.constants';

/** 开台分布式锁超时（秒）：事务最长耗时预估 + 冗余 */
const OPEN_SESSION_LOCK_TTL_SECONDS = 15;
/** 开台分布式锁重试次数：高并发时短暂等待后重试 */
const OPEN_SESSION_LOCK_RETRY_TIMES = 3;
/** 开台分布式锁重试间隔（毫秒） */
const OPEN_SESSION_LOCK_RETRY_DELAY_MS = 60;

@Injectable()
export class SpaceSessionOpenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly reservationsStateService: SpaceReservationsStateService,
    private readonly redisLockService: RedisLockService,
  ) {}

  async openSession(
    user: AuthenticatedUser,
    spaceId: number,
    dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    // B1 fix: 软删除空间不可开台，与 listSpaces 的 deletedAt: null 口径一致
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      include: {
        type: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'operation-entry:create',
      '无权在该门店空间开台',
    );

    // Space.status 已移除，改为运行态推导：查询是否存在 active session
    const existingActiveSession = await this.prisma.spaceSession.findFirst({
      where: {
        spaceId: space.id,
        status: PrismaSpaceSessionStatus.active,
      },
      select: { id: true },
    });

    if (existingActiveSession) {
      throw new ConflictException('空间当前使用中，无法重复开台');
    }

    const payload = normalizeOpenSessionPayload(dto);
    ensureOpenSessionPayload(payload, space.capacity ?? undefined);

    if (payload.reservationId !== undefined) {
      await this.reservationsStateService.ensureReservationCanBeFulfilled(
        space.storeId,
        space.id,
        payload.reservationId,
      );
    }

    // 分布式锁：防止多 worker 并发对同一空间重复开台
    // 注意：FOR UPDATE 行锁保留，作为数据库层的最终保底
    const lock = await this.redisLockService.acquireLock(
      `space:session:open:${space.id}`,
      {
        ttlSeconds: OPEN_SESSION_LOCK_TTL_SECONDS,
        retryTimes: OPEN_SESSION_LOCK_RETRY_TIMES,
        retryDelayMs: OPEN_SESSION_LOCK_RETRY_DELAY_MS,
      },
    );

    if (!lock) {
      throw new ConflictException('当前空间正在处理其他操作，请稍后重试');
    }

    try {
      return await this.openSessionUnderLock(user, space, payload);
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  private async openSessionUnderLock(
    user: AuthenticatedUser,
    space: {
      id: number;
      storeId: number;
      capacity: number | null;
      autoCheckout: boolean;
    },
    payload: ReturnType<typeof normalizeOpenSessionPayload>,
  ): Promise<SpaceSessionResponseDto> {
    // 在事务外解析开台操作员，避免在事务中额外查询
    const openOperatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        space.storeId,
      );
    let openOperatorNameSnapshot: string | null = null;
    if (openOperatorStaffId != null) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: openOperatorStaffId },
        select: { name: true },
      });
      openOperatorNameSnapshot = staff?.name ?? null;
    }

    const session = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${space.id}
        FOR UPDATE
      `;

        // Space.status 已移除，改为检查是否有 active session（双重检查）
        const activeSession = await transaction.spaceSession.findFirst({
          where: {
            spaceId: space.id,
            status: PrismaSpaceSessionStatus.active,
          },
          select: {
            id: true,
          },
        });

        if (activeSession) {
          throw new ConflictException('空间当前使用中，无法重复开台');
        }

        if (payload.reservationId !== undefined) {
          const latestReservation =
            await transaction.spaceReservation.findUnique({
              where: { id: payload.reservationId },
              select: {
                id: true,
                storeId: true,
                spaceId: true,
                status: true,
              },
            });

          if (!latestReservation) {
            throw new NotFoundException('预约不存在');
          }
          if (
            latestReservation.storeId !== space.storeId ||
            latestReservation.spaceId !== space.id
          ) {
            throw new ConflictException('该预约不属于当前空间，无法履约开台');
          }
          if (
            latestReservation.status !== PrismaSpaceReservationStatus.pending
          ) {
            throw new ConflictException('当前预约已处理，无法再次履约开台');
          }

          const fulfilledReservation =
            await transaction.spaceReservation.updateMany({
              where: {
                id: payload.reservationId,
                status: PrismaSpaceReservationStatus.pending,
              },
              data: {
                status: PrismaSpaceReservationStatus.fulfilled,
              },
            });

          if (fulfilledReservation.count !== 1) {
            throw new ConflictException('当前预约已处理，无法再次履约开台');
          }
        }

        const created = await transaction.spaceSession.create({
          data: {
            storeId: space.storeId,
            spaceId: space.id,
            reservationId: payload.reservationId,
            guestName: payload.guestName ?? null,
            guestPhone: payload.guestPhone ?? null,
            guestCount: payload.guestCount ?? null,
            startTime: new Date(),
            billingMode: this.toPrismaSpaceBillingMode(payload.billingMode),
            hourlyRate:
              payload.hourlyRate !== undefined
                ? Money.fromInputYuan(payload.hourlyRate).toDbCents()
                : null,
            countdownMinutes: payload.countdownMinutes ?? null,
            // B4 fix: autoCheckout 未传时继承空间配置，避免运行态与会话级漂移，
            // 同时保证换房强校验 Boolean(session.autoCheckout) !== targetSpace.autoCheckout 有意义。
            autoCheckout: payload.autoCheckout ?? space.autoCheckout ?? null,
            prepaidPaymentMethod: payload.prepaidPaymentMethod ?? null,
            prepaidCustomerPaymentMethod:
              payload.prepaidCustomerPaymentMethod ?? null,
            prepaidSettlementChannel: payload.prepaidSettlementChannel ?? null,
            prepaidGrouponCode: payload.prepaidGrouponCode ?? null,
            prepaidGrouponPlatform: payload.prepaidGrouponPlatform ?? null,
            prepaidVoucherCode: payload.prepaidVoucherCode ?? null,
            prepaidVoucherPlatform: payload.prepaidVoucherPlatform ?? null,
            prepaidNote: payload.prepaidNote ?? null,
            prepaidAmount:
              payload.prepaidAmount !== undefined
                ? Money.fromInputYuan(payload.prepaidAmount).toDbCents()
                : null,
            prepaidVoucherFaceAmount:
              payload.prepaidVoucherFaceAmount !== undefined
                ? Money.fromInputYuan(
                    payload.prepaidVoucherFaceAmount,
                  ).toDbCents()
                : null,
            /// Step 8.1: items/renewRecords 已拆为独立表，开台时为空
            itemsCost: 0,
            openOperatorStaffId,
            openOperatorNameSnapshot,
            status: PrismaSpaceSessionStatus.active,
          },
          include: {
            space: {
              select: {
                id: true,
                name: true,
                type: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });

        // Space.status 已移除，不再更新空间状态字段

        // 纯利宝团购券自动核销：读取过的券码开台成功后绑定会话并置已使用；
        // 已开台使用的券再次开台 → 抛"该团购券已使用"，整笔事务回滚
        if (payload.prepaidVoucherCode) {
          await bindVoucherOnOpen(transaction, {
            voucherCode: payload.prepaidVoucherCode,
            voucherPlatform: payload.prepaidVoucherPlatform ?? '',
            storeId: space.storeId,
            sessionId: created.id,
          });
        }

        return created;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return toSpaceSessionResponse(session);
  }

  private toPrismaSpaceBillingMode(
    value: SpaceBillingModeValue,
  ): PrismaSpaceBillingMode {
    return value;
  }
}
