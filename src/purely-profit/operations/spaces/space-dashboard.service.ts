import { Injectable } from '@nestjs/common';
import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  GetSpacesDashboardQueryDto,
  type SpaceDashboardFilterOptionsDto,
  type SpaceDashboardSpaceItemDto,
  type SpaceStatsResponseDto,
  type SpacesDashboardResponseDto,
} from './dto/space.dto';
import { toSpaceResponse, type SpaceWithRelations } from './spaces.mapper';
import { SPACE_WITH_RELATIONS_INCLUDE } from './spaces.query';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import {
  SpaceDashboardSummaryService,
  type DashboardSpaceSummaryBundle,
} from './space-dashboard-summary.service';

@Injectable()
export class SpaceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly autoCheckoutService: SpaceSessionAutoCheckoutService,
    private readonly summaryService: SpaceDashboardSummaryService,
  ) {}

  async getSpacesDashboard(
    user: AuthenticatedUser,
    query: GetSpacesDashboardQueryDto,
    requestId?: string,
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

    await this.autoCheckoutService.autoCheckoutExpiredCountdownSessions(
      user,
      storeId,
      Date.now(),
      'spaces:dashboard',
      requestId,
    );

    const [spaces, sessionStats, dashboardSummaries] = await Promise.all([
      this.findSpacesByStore(storeId),
      this.summaryService.buildTodaySettledSessionStats(storeId),
      this.summaryService.buildDashboardSpaceSummaryBundle(storeId),
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
}
