import { Injectable } from '@nestjs/common';
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
import { toSpaceResponse } from './spaces.mapper';
import {
  SpaceDashboardSummaryService,
  type DashboardSpaceSummaryBundle,
} from './space-dashboard-summary.service';

@Injectable()
export class SpaceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly summaryService: SpaceDashboardSummaryService,
  ) {}

  async getSpacesDashboard(
    user: AuthenticatedUser,
    query: GetSpacesDashboardQueryDto,
    requestId?: string,
  ): Promise<SpacesDashboardResponseDto> {
    void requestId;
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
    spaces: Awaited<ReturnType<typeof this.findSpacesByStore>>,
    sessionStats: {
      todaySettled: number;
      todayRevenue: number;
    },
  ): SpaceStatsResponseDto {
    let idle = 0;
    let occupied = 0;
    let reserved = 0;
    const cleaning = 0;

    // Space.status 已移除，状态由运行态推导
    // 使用 summaries 中的 activeSession 和 activeReservation 计算状态
    for (const space of spaces) {
      const hasActiveSession = this.hasActiveSession(space);
      const hasActiveReservation = this.hasActiveReservation(space);
      const hasDirtyRoom = space.enableDirtyRoom;

      if (hasActiveSession) {
        occupied += 1;
      } else if (hasDirtyRoom) {
        // 脏房模式：结账后需要清洁
        // 由于没有存储状态，这里简化处理：有活跃预约则 reserved，否则 idle
        // 实际的 cleaning 状态需要结合会话结算时间判断，这里暂不实现
        if (hasActiveReservation) {
          reserved += 1;
        } else {
          idle += 1;
        }
      } else if (hasActiveReservation) {
        reserved += 1;
      } else {
        idle += 1;
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
    spaces: Awaited<ReturnType<typeof this.findSpacesByStore>>,
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

  private async findSpacesByStore(storeId: number) {
    const todayRange = this.getTodayRange();

    // Space.status 已移除，需要关联查询 session 和 reservation
    return this.prisma.space.findMany({
      where: { storeId },
      include: {
        type: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        _count: {
          select: {
            sessions: { where: { status: 'active' } },
            reservations: {
              where: {
                status: 'pending',
                reservedAt: { gte: todayRange.start, lte: todayRange.end },
              },
            },
          },
        },
        sessions: {
          where: { status: 'active' },
          select: { id: true },
        },
        reservations: {
          where: {
            status: 'pending',
            reservedAt: { gte: todayRange.start, lte: todayRange.end },
          },
          select: { id: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private hasActiveSession(space: { sessions: { id: number }[] }): boolean {
    return space.sessions.length > 0;
  }

  private hasActiveReservation(space: {
    reservations: { id: number }[];
  }): boolean {
    return space.reservations.length > 0;
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

  private toSpaceDashboardItem(
    space: Awaited<ReturnType<typeof this.findSpacesByStore>>[number],
    summaries: DashboardSpaceSummaryBundle,
  ): SpaceDashboardSpaceItemDto {
    // 运行态推导 status
    const hasActiveSession = space.sessions.length > 0;
    const hasActiveReservation = space.reservations.length > 0;
    const status = hasActiveSession
      ? 'occupied'
      : hasActiveReservation
        ? 'reserved'
        : 'idle';

    return {
      ...toSpaceResponse({
        ...space,
        status,
      }),
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
