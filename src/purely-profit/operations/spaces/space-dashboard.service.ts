import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import {
  GetSpacesDashboardQueryDto,
  type SpaceDashboardActiveSessionSummaryDto,
  type SpaceDashboardFilterOptionsDto,
  type SpaceDashboardReservationSummaryDto,
  type SpaceDashboardSpaceItemDto,
  type SpaceStatsResponseDto,
  type SpacesDashboardResponseDto,
} from './dto/space.dto';
import {
  SpaceSessionsService,
  type SpaceSessionItemRecord,
  type SpaceSessionRenewRecord,
} from './space-sessions.service';
import { toSpaceResponse, type SpaceWithRelations } from './spaces.mapper';
import { SPACE_WITH_RELATIONS_INCLUDE } from './spaces.query';

interface DashboardSpaceSummaryBundle {
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
export class SpaceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly spaceSessionsService: SpaceSessionsService,
  ) {}

  async getSpacesDashboard(
    user: AuthenticatedUser,
    query: GetSpacesDashboardQueryDto,
  ): Promise<SpacesDashboardResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间看板',
    );

    if (storeId === null) {
      return this.buildEmptyDashboard();
    }

    const [spaces, sessionStats, dashboardSummaries] = await Promise.all([
      this.findSpacesByStore(storeId),
      this.buildTodaySettledSessionStats(storeId),
      this.buildDashboardSpaceSummaryBundle(storeId),
    ]);

    return {
      stats: this.buildSpaceStats(spaces, sessionStats),
      filterOptions: this.buildFilterOptions(spaces),
      spaces: spaces.map((space) =>
        this.toSpaceDashboardItem(space, dashboardSummaries),
      ),
    };
  }

  private buildEmptyDashboard(): SpacesDashboardResponseDto {
    return {
      stats: {
        total: 0,
        idle: 0,
        occupied: 0,
        reserved: 0,
        cleaning: 0,
        todaySettled: 0,
        todayRevenue: 0,
      },
      filterOptions: {
        types: [],
        zones: [],
        showDirtyTab: false,
      },
      spaces: [],
    };
  }

  private async buildDashboardSpaceSummaryBundle(
    storeId: number,
  ): Promise<DashboardSpaceSummaryBundle> {
    const now = Date.now();
    const todayRange = this.getTodayRange();
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
          renewRecords: true,
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

  private buildSpaceStats(
    spaces: SpaceWithRelations[],
    sessionStats: {
      todaySettled: number;
      todayRevenue: number;
    },
  ): SpaceStatsResponseDto {
    let idle = 0;
    let occupied = 0;
    let reserved = 0;
    let cleaning = 0;

    for (const space of spaces) {
      if (space.status === PrismaSpaceStatus.idle) {
        idle += 1;
      } else if (space.status === PrismaSpaceStatus.occupied) {
        occupied += 1;
      } else if (space.status === PrismaSpaceStatus.reserved) {
        reserved += 1;
      } else if (space.status === PrismaSpaceStatus.cleaning) {
        cleaning += 1;
      }
    }

    return {
      total: spaces.length,
      idle,
      occupied,
      reserved,
      cleaning,
      todaySettled: sessionStats.todaySettled,
      todayRevenue: sessionStats.todayRevenue,
    };
  }

  private async buildTodaySettledSessionStats(storeId: number): Promise<{
    todaySettled: number;
    todayRevenue: number;
  }> {
    const todayRange = this.getTodayRange();
    const sessions = await this.prisma.spaceSession.findMany({
      where: {
        storeId,
        status: PrismaSpaceSessionStatus.settled,
        endTime: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      select: {
        id: true,
        items: true,
      },
    });

    return {
      todaySettled: sessions.length,
      todayRevenue: Number(
        sessions
          .reduce((sum, session) => {
            const items: SpaceSessionItemRecord[] =
              this.spaceSessionsService.parseSpaceSessionItems(session.items);
            return sum + this.spaceSessionsService.sumLineTotal(items);
          }, 0)
          .toFixed(2),
      ),
    };
  }

  private buildFilterOptions(
    spaces: SpaceWithRelations[],
  ): SpaceDashboardFilterOptionsDto {
    const types = Array.from(
      new Set(spaces.map((space) => space.type.name)),
    ).sort();
    const zones = Array.from(
      new Set(
        spaces
          .map((space) => space.zone?.name)
          .filter((zone): zone is string => Boolean(zone)),
      ),
    ).sort();

    return {
      types,
      zones,
      showDirtyTab: spaces.some((space) => space.enableDirtyRoom),
    };
  }

  private async findSpacesByStore(
    storeId: number,
  ): Promise<SpaceWithRelations[]> {
    return this.prisma.space.findMany({
      where: { storeId },
      include: SPACE_WITH_RELATIONS_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private toSpaceDashboardItem(
    space: SpaceWithRelations,
    summaries: DashboardSpaceSummaryBundle,
  ): SpaceDashboardSpaceItemDto {
    return {
      ...toSpaceResponse(space),
      ...(summaries.activeSessionSummaryBySpaceId.has(space.id)
        ? {
            activeSessionSummary: summaries.activeSessionSummaryBySpaceId.get(
              space.id,
            ),
          }
        : {}),
      ...(summaries.activeReservationSummaryBySpaceId.has(space.id)
        ? {
            activeReservationSummary:
              summaries.activeReservationSummaryBySpaceId.get(space.id),
          }
        : {}),
      ...(summaries.futureReservationSummaryBySpaceId.has(space.id)
        ? {
            futureReservationSummary:
              summaries.futureReservationSummaryBySpaceId.get(space.id),
          }
        : {}),
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
    hourlyRate: Prisma.Decimal | null;
    countdownMinutes: number | null;
    itemsCost: Prisma.Decimal;
    renewRecords: Prisma.JsonValue;
    autoCheckout: boolean | null;
    prepaidPaymentMethod: SalesPaymentMethodValue | null;
    prepaidGrouponCode: string | null;
    prepaidNote: string | null;
    prepaidAmount: Prisma.Decimal | null;
  }): SpaceDashboardActiveSessionSummaryDto {
    const renewRecords: SpaceSessionRenewRecord[] =
      this.spaceSessionsService.parseSpaceSessionRenewRecords(
        session.renewRecords,
      );

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
        ? { hourlyRate: Number(session.hourlyRate) }
        : {}),
      ...(session.countdownMinutes !== null
        ? { countdownMinutes: session.countdownMinutes }
        : {}),
      itemsCost: Number(session.itemsCost),
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
        ? { prepaidAmount: Number(session.prepaidAmount) }
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

  private getTodayRange(): { start: Date; end: Date } {
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
  }
}
