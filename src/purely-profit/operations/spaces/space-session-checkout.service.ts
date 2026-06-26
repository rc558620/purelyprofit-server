import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutLockPayload } from './space-sessions.types';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
  CheckoutSpaceSessionPreviewResponseDto,
  CheckoutSpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import {
  buildSpaceSessionSettlement,
  resolveCheckoutPreviewFeeMode,
} from './space-session-settlement.shared';
import {
  normalizeCheckoutPayload,
  normalizeCheckoutPreviewPayload,
} from './space-session-checkout-payload.shared';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type { SpaceSessionRecord } from './space-sessions.types';
import type { SpaceStatusValue } from './spaces.constants';

const SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS = 5 * 60;

@Injectable()
export class SpaceSessionCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly checkoutLockService: SpaceSessionCheckoutLockService,
    private readonly settlementService: SpaceSessionSettlementService,
    private readonly reservationsStateService: SpaceReservationsStateService,
  ) {}

  async previewSpaceSessionCheckout(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionPreviewDto,
  ): Promise<CheckoutSpaceSessionPreviewResponseDto> {
    const session = await this.findSettlementSessionById(sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间创建结账预览',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法创建锁单');
    }

    const lockedAt = Date.now();
    const payload = normalizeCheckoutPreviewPayload(dto);
    const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);
    const settlement = buildSpaceSessionSettlement({
      session,
      checkoutAt: lockedAt,
      payload,
      items: mapSessionItemRows(session.sessionItems),
      renewRecords,
    });

    const { lockId, expiresAt } = await this.checkoutLockService.createLock({
      ttlSeconds: SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS,
      payload: {
        sessionId: session.id,
        lockedAt,
        sessionUpdatedAt: session.updatedAt.getTime(),
        ...(payload.timeFeeMode ? { timeFeeMode: payload.timeFeeMode } : {}),
        ...(settlement.countdownFeeMode
          ? { countdownFeeMode: settlement.countdownFeeMode }
          : {}),
      },
    });

    return {
      lockId,
      lockedAt,
      expiresAt,
      preview: {
        durationMinutes: settlement.durationMinutes,
        durationLabel: settlement.durationLabel,
        timeCost: settlement.timeCost,
        itemsCost: settlement.itemsCost,
        renewDeduction: settlement.renewDeduction,
        prepaidDeduction: settlement.prepaidDeduction,
        totalAmount: settlement.totalAmount,
        ...resolveCheckoutPreviewFeeMode(
          session.billingMode,
          payload,
          renewRecords,
        ),
      },
    };
  }

  async checkoutSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionDto,
  ): Promise<CheckoutSpaceSessionResponseDto> {
    const session = await this.findSettlementSessionById(sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间结账',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法重复操作');
    }

    const payload = normalizeCheckoutPayload(dto);
    const lockPayload = await this.resolveCheckoutLockPayload(session, payload);
    const checkoutAt = lockPayload?.lockedAt ?? payload.lockedAt ?? Date.now();
    if (checkoutAt < session.startTime.getTime()) {
      throw new BadRequestException('锁单时间不能早于开台时间');
    }

    const timeFeeMode = lockPayload?.timeFeeMode ?? payload.timeFeeMode;
    const countdownFeeMode =
      lockPayload?.countdownFeeMode ?? payload.countdownFeeMode;
    const items = mapSessionItemRows(session.sessionItems);
    const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);
    const settlement = buildSpaceSessionSettlement({
      session,
      checkoutAt,
      payload: { timeFeeMode, countdownFeeMode },
      items,
      renewRecords,
    });

    const updated = await this.settlementService.settleSession(user, {
      session,
      checkoutAt,
      paymentMethod: payload.paymentMethod,
      note: payload.note,
      settlement,
      renewRecords,
    });

    if (payload.lockId) {
      await this.checkoutLockService.deleteLock(payload.lockId);
    }

    // 运行态推导结算后的空间状态：根据 enableDirtyRoom 和是否有 pending 预约
    const spaceStatus =
      await this.reservationsStateService.resolveReservationBackStatus(
        this.prisma,
        session.spaceId,
        session.space.enableDirtyRoom,
      );

    return {
      session: toSpaceSessionResponse(updated.session),
      spaceStatus: this.toSpaceStatusValue(spaceStatus),
      ...(updated.cancelledReservationId !== null
        ? { cancelledReservationId: String(updated.cancelledReservationId) }
        : {}),
      salesOrder: updated.salesOrder,
    };
  }

  private async findSettlementSessionById(sessionId: number): Promise<
    SpaceSessionRecord & {
      space: {
        id: number;
        name: string;
        enableDirtyRoom: boolean;
        type: {
          name: string;
        };
      };
    }
  > {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            enableDirtyRoom: true,
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

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    return session;
  }

  private async resolveCheckoutLockPayload(
    session: SpaceSessionRecord,
    payload: ReturnType<typeof normalizeCheckoutPayload>,
  ): Promise<SpaceSessionCheckoutLockPayload | null> {
    if (!payload.lockId) {
      return null;
    }

    return this.checkoutLockService.requireValidLock({
      sessionId: session.id,
      lockId: payload.lockId,
      sessionUpdatedAt: session.updatedAt.getTime(),
      timeFeeMode: payload.timeFeeMode,
      countdownFeeMode: payload.countdownFeeMode,
    });
  }

  private toSpaceStatusValue(status: string): SpaceStatusValue {
    return status as SpaceStatusValue;
  }
}
