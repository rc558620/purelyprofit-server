import { Injectable } from '@nestjs/common';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import type {
  SpaceDashboardActiveSessionSummaryDto,
  SpaceDashboardReservationSummaryDto,
} from './dto/space.dto';
import { mapRenewRecordRows } from './space-sessions.mapper';
import type { SpaceSessionRenewRecordRow } from './space-sessions.types';

export interface DashboardSpaceSummaryBundle {
  activeSessionSummaryBySpaceId: Map<
    number,
    SpaceDashboardActiveSessionSummaryDto
  >;
  activeReservationSummaryBySpaceId: Map<
    number,
    SpaceDashboardReservationSummaryDto
  >;
  futureReservationSummaryBySpaceId: Map<
    number,
    SpaceDashboardReservationSummaryDto
  >;
}

@Injectable()
export class SpaceDashboardSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async buildDashboardSpaceSummaryBundle(
    storeId: number,
  ): Promise<DashboardSpaceSummaryBundle> {
    const now = Date.now();
    const todayRange = getTodayRange();
    const [activeSessions, pendingReservations] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where: {
          storeId,
          status: PrismaSpaceSessionStatus.active,
        },
        select: {
          id: true,
          spaceId: true,
          guestName: true,
          guestPhone: true,
          guestCount: true,
          billingMode: true,
          startTime: true,
          hourlyRate: true,
          countdownMinutes: true,
          itemsCost: true,
          sessionRenewRecords: {
            orderBy: { id: 'asc' },
          },
          autoCheckout: true,
          prepaidPaymentMethod: true,
          prepaidGrouponCode: true,
          prepaidNote: true,
          prepaidAmount: true,
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.spaceReservation.findMany({
        where: {
          storeId,
          status: PrismaSpaceReservationStatus.pending,
        },
        select: {
          id: true,
          spaceId: true,
          guestName: true,
          phone: true,
          guestCount: true,
          reservedAt: true,
          reservedEndAt: true,
        },
        orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const activeSessionSummaryBySpaceId = new Map<
      number,
      SpaceDashboardActiveSessionSummaryDto
    >();
    for (const session of activeSessions) {
      if (activeSessionSummaryBySpaceId.has(session.spaceId)) {
        continue;
      }

      activeSessionSummaryBySpaceId.set(
        session.spaceId,
        this.toSpaceDashboardActiveSessionSummary(session),
      );
    }

    const reservationsBySpaceId = new Map<number, typeof pendingReservations>();
    for (const reservation of pendingReservations) {
      const group = reservationsBySpaceId.get(reservation.spaceId);
      if (group) {
        group.push(reservation);
      } else {
        reservationsBySpaceId.set(reservation.spaceId, [reservation]);
      }
    }

    const activeReservationSummaryBySpaceId = new Map<
      number,
      SpaceDashboardReservationSummaryDto
    >();
    const futureReservationSummaryBySpaceId = new Map<
      number,
      SpaceDashboardReservationSummaryDto
    >();

    for (const [spaceId, reservations] of reservationsBySpaceId) {
      const upcomingTodayReservation = reservations.find(
        (reservation) =>
          reservation.reservedAt.getTime() > now &&
          reservation.reservedAt >= todayRange.start &&
          reservation.reservedAt <= todayRange.end,
      );
      const overdueReservation = reservations.find(
        (reservation) => reservation.reservedAt.getTime() <= now,
      );
      const activeReservation = upcomingTodayReservation ?? overdueReservation;
      if (activeReservation) {
        activeReservationSummaryBySpaceId.set(
          spaceId,
          this.toSpaceDashboardReservationSummary(
            activeReservation,
            activeReservation.reservedAt.getTime() <= now,
          ),
        );
      }

      const futureReservation = reservations.find(
        (reservation) => reservation.reservedAt > todayRange.end,
      );
      if (futureReservation) {
        futureReservationSummaryBySpaceId.set(
          spaceId,
          this.toSpaceDashboardReservationSummary(futureReservation),
        );
      }
    }

    return {
      activeSessionSummaryBySpaceId,
      activeReservationSummaryBySpaceId,
      futureReservationSummaryBySpaceId,
    };
  }

  async buildTodaySettledSessionStats(storeId: number): Promise<{
    todaySettled: number;
    todayRevenue: number;
  }> {
    const todayRange = getTodayRange();
    const [todaySettled, revenueAgg] = await Promise.all([
      this.prisma.spaceSession.count({
        where: {
          storeId,
          status: PrismaSpaceSessionStatus.settled,
          endTime: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
        },
      }),
      this.prisma.saleOrder.aggregate({
        where: {
          storeId,
          date: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
          spaceSession: {
            isNot: null,
          },
        },
        _sum: {
          totalRevenue: true,
        },
      }),
    ]);

    return {
      todaySettled,
      todayRevenue: Number(revenueAgg._sum.totalRevenue ?? 0),
    };
  }

  private toSpaceDashboardActiveSessionSummary(session: {
    id: number;
    spaceId: number;
    guestName: string | null;
    guestPhone: string | null;
    guestCount: number | null;
    billingMode: PrismaSpaceBillingMode;
    startTime: Date;
    hourlyRate: number | null;
    countdownMinutes: number | null;
    itemsCost: number;
    sessionRenewRecords: SpaceSessionRenewRecordRow[];
    autoCheckout: boolean | null;
    prepaidPaymentMethod: SalesPaymentMethodValue | null;
    prepaidGrouponCode: string | null;
    prepaidNote: string | null;
    prepaidAmount: number | null;
  }): SpaceDashboardActiveSessionSummaryDto {
    const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);

    return {
      sessionId: String(session.id),
      ...(session.guestName ? { guestName: session.guestName } : {}),
      ...(session.guestPhone ? { guestPhone: session.guestPhone } : {}),
      ...(session.guestCount !== null
        ? { guestCount: session.guestCount }
        : {}),
      billingMode: session.billingMode,
      startTime: toTimestampMs(session.startTime),
      ...(session.hourlyRate !== null
        ? { hourlyRate: session.hourlyRate }
        : {}),
      ...(session.countdownMinutes !== null
        ? { countdownMinutes: session.countdownMinutes }
        : {}),
      itemsCost: session.itemsCost,
      renewCount: renewRecords.length,
      ...(session.autoCheckout !== null
        ? { autoCheckout: session.autoCheckout }
        : {}),
      ...(session.prepaidPaymentMethod
        ? { prepaidPaymentMethod: session.prepaidPaymentMethod }
        : {}),
      ...(session.prepaidGrouponCode
        ? { prepaidGrouponCode: session.prepaidGrouponCode }
        : {}),
      ...(session.prepaidNote ? { prepaidNote: session.prepaidNote } : {}),
      ...(session.prepaidAmount !== null
        ? { prepaidAmount: session.prepaidAmount }
        : {}),
    };
  }

  private toSpaceDashboardReservationSummary(
    reservation: {
      id: number;
      guestName: string;
      phone: string | null;
      guestCount: number | null;
      reservedAt: Date;
      reservedEndAt: Date | null;
    },
    isOverdue?: boolean,
  ): SpaceDashboardReservationSummaryDto {
    return {
      reservationId: String(reservation.id),
      guestName: reservation.guestName,
      ...(reservation.phone ? { phone: reservation.phone } : {}),
      ...(reservation.guestCount !== null
        ? { guestCount: reservation.guestCount }
        : {}),
      reservedAt: toTimestampMs(reservation.reservedAt),
      ...(reservation.reservedEndAt
        ? { reservedEndAt: toTimestampMs(reservation.reservedEndAt) }
        : {}),
      ...(isOverdue !== undefined ? { isOverdue } : {}),
    };
  }
}

const getTodayRange = (): { start: Date; end: Date } => {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { start, end };
};
