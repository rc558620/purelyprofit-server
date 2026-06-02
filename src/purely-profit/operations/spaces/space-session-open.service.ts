import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  OpenSpaceSessionDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { normalizeOpenSessionPayload } from './space-session-payload.shared';
import { ensureOpenSessionPayload } from './space-session-open-validation.shared';
import type { SpaceBillingModeValue } from './spaces.constants';

@Injectable()
export class SpaceSessionOpenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async openSession(
    user: AuthenticatedUser,
    spaceId: number,
    dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
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

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间当前使用中，无法重复开台');
    }

    if (space.status === PrismaSpaceStatus.cleaning) {
      throw new ConflictException('空间待清洁，暂时无法开台');
    }

    if (space.status === PrismaSpaceStatus.reserved) {
      const pendingReservation = await this.prisma.spaceReservation.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceReservationStatus.pending,
        },
        select: { id: true },
      });

      if (!pendingReservation) {
        throw new ConflictException('空间预约状态异常，请刷新后重试');
      }
    }

    const payload = normalizeOpenSessionPayload(dto);
    ensureOpenSessionPayload(payload, space.capacity ?? undefined);

    if (payload.reservationId !== undefined) {
      await this.ensureReservationCanBeFulfilled(
        space.storeId,
        space.id,
        payload.reservationId,
      );
    }

    const session = await this.prisma.$transaction(async (transaction) => {
      if (space.status === PrismaSpaceStatus.reserved) {
        const latestPendingReservation =
          await transaction.spaceReservation.findFirst({
            where: {
              spaceId: space.id,
              status: PrismaSpaceReservationStatus.pending,
            },
            select: { id: true },
          });

        if (!latestPendingReservation) {
          throw new ConflictException('空间预约状态异常，请刷新后重试');
        }
      }

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
        await transaction.spaceReservation.update({
          where: { id: payload.reservationId },
          data: {
            status: PrismaSpaceReservationStatus.fulfilled,
          },
        });
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
              ? new Prisma.Decimal(payload.hourlyRate)
              : null,
          countdownMinutes: payload.countdownMinutes ?? null,
          autoCheckout: payload.autoCheckout ?? null,
          prepaidPaymentMethod: payload.prepaidPaymentMethod ?? null,
          prepaidGrouponCode: payload.prepaidGrouponCode ?? null,
          prepaidNote: payload.prepaidNote ?? null,
          prepaidAmount:
            payload.prepaidAmount !== undefined
              ? new Prisma.Decimal(payload.prepaidAmount)
              : null,
          items: [],
          itemsCost: new Prisma.Decimal(0),
          renewRecords: [],
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
        },
      });

      await transaction.space.update({
        where: { id: space.id },
        data: { status: PrismaSpaceStatus.occupied },
      });

      return created;
    });

    return toSpaceSessionResponse(session);
  }

  private async ensureReservationCanBeFulfilled(
    storeId: number,
    spaceId: number,
    reservationId: number,
  ): Promise<void> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }
    if (reservation.storeId !== storeId || reservation.spaceId !== spaceId) {
      throw new ConflictException('该预约不属于当前空间，无法履约开台');
    }
    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法再次履约开台');
    }
  }

  private toPrismaSpaceBillingMode(
    value: SpaceBillingModeValue,
  ): PrismaSpaceBillingMode {
    return value;
  }
}
