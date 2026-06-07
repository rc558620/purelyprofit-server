import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  findNearestReservationMatch,
  getTodayRange,
} from './space-reservations.shared';
import type {
  SpaceReservationRecord,
  SpaceReservationSessionSnapshot,
} from './space-reservations.types';

@Injectable()
export class SpaceReservationsStateService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureReservationCanBeFulfilled(
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

  async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<PrismaSpaceStatus> {
    const todayRange = getTodayRange();
    const hasTodayPendingReservation =
      await transaction.spaceReservation.findFirst({
        where: {
          spaceId,
          status: PrismaSpaceReservationStatus.pending,
          reservedAt: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
        },
        select: {
          id: true,
        },
      });

    return hasTodayPendingReservation
      ? PrismaSpaceStatus.reserved
      : PrismaSpaceStatus.idle;
  }

  async syncNonOccupiedSpaceStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<void> {
    const current = await transaction.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!current) {
      throw new NotFoundException('空间不存在');
    }

    if (
      current.status === PrismaSpaceStatus.occupied ||
      current.status === PrismaSpaceStatus.cleaning
    ) {
      return;
    }

    const nextStatus = await this.resolveReservationBackStatus(
      transaction,
      spaceId,
    );

    if (nextStatus !== current.status) {
      await transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
      });
    }
  }

  async repairInconsistentOccupiedSpace(spaceId: number): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const nextStatus = await this.resolveReservationBackStatus(
        transaction,
        spaceId,
      );

      await transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
      });
    });
  }

  async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: SpaceReservationSessionSnapshot,
  ): Promise<number | null> {
    if (session.reservationId !== null) {
      return null;
    }

    const guestName = session.guestName?.trim();
    const guestPhone = session.guestPhone?.trim();
    if (!guestName || !guestPhone) {
      return null;
    }

    const todayRange = getTodayRange();
    const candidates = await transaction.spaceReservation.findMany({
      where: {
        spaceId: session.spaceId,
        status: PrismaSpaceReservationStatus.pending,
        guestName,
        phone: guestPhone,
        reservedAt: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const nearest = findNearestReservationMatch(
      candidates as SpaceReservationRecord[],
      session.startTime,
    );
    if (!nearest) {
      return null;
    }

    await transaction.spaceReservation.update({
      where: { id: nearest.id },
      data: {
        status: PrismaSpaceReservationStatus.cancelled,
      },
    });

    return nearest.id;
  }
}
