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
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type { SpaceBillingModeValue } from './spaces.constants';

@Injectable()
export class SpaceSessionOpenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly reservationsStateService: SpaceReservationsStateService,
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
      // 检查是否存在真正的 active session；如无，则说明空间状态不一致（可能因为交班/排班删除等）
      // 这种情况下应该允许继续开台，但先自动修复空间状态
      const occupiedSession = await this.prisma.spaceSession.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceSessionStatus.active,
        },
        select: { id: true },
      });

      if (!occupiedSession) {
        // 空间状态异常：标记为 occupied 但不存在 active session
        // 自动修复为正确状态后，继续处理开台逻辑
        await this.reservationsStateService.repairInconsistentOccupiedSpace(
          space.id,
        );
        // 继续执行后续开台逻辑，不抛异常
      } else {
        // 空间确实在使用中，拒绝重复开台
        throw new ConflictException('空间当前使用中，无法重复开台');
      }
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
      await this.reservationsStateService.ensureReservationCanBeFulfilled(
        space.storeId,
        space.id,
        payload.reservationId,
      );
    }

    const session = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${space.id}
        FOR UPDATE
      `;

      const latestSpace = await transaction.space.findUnique({
        where: { id: space.id },
        select: {
          id: true,
          status: true,
        },
      });

      if (!latestSpace) {
        throw new NotFoundException('空间不存在');
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

      let effectiveSpaceStatus = latestSpace.status;
      if (effectiveSpaceStatus === PrismaSpaceStatus.occupied) {
        effectiveSpaceStatus =
          await this.reservationsStateService.resolveReservationBackStatus(
            transaction,
            space.id,
          );

        await transaction.space.update({
          where: { id: space.id },
          data: {
            status: effectiveSpaceStatus,
          },
        });
      }

      if (effectiveSpaceStatus === PrismaSpaceStatus.cleaning) {
        throw new ConflictException('空间待清洁，暂时无法开台');
      }

      if (effectiveSpaceStatus === PrismaSpaceStatus.reserved) {
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

      if (payload.reservationId !== undefined) {
        const latestReservation = await transaction.spaceReservation.findUnique(
          {
            where: { id: payload.reservationId },
            select: {
              id: true,
              storeId: true,
              spaceId: true,
              status: true,
            },
          },
        );

        if (!latestReservation) {
          throw new NotFoundException('预约不存在');
        }
        if (
          latestReservation.storeId !== space.storeId ||
          latestReservation.spaceId !== space.id
        ) {
          throw new ConflictException('该预约不属于当前空间，无法履约开台');
        }
        if (latestReservation.status !== PrismaSpaceReservationStatus.pending) {
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
              ? new Prisma.Decimal(payload.hourlyRate)
              : null,
          countdownMinutes: payload.countdownMinutes ?? null,
          autoCheckout: payload.autoCheckout ?? null,
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
              ? new Prisma.Decimal(payload.prepaidAmount)
              : null,
          prepaidVoucherFaceAmount:
            payload.prepaidVoucherFaceAmount !== undefined
              ? new Prisma.Decimal(payload.prepaidVoucherFaceAmount)
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

  private toPrismaSpaceBillingMode(
    value: SpaceBillingModeValue,
  ): PrismaSpaceBillingMode {
    return value;
  }
}
