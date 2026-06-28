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
import type { SpaceStatusValue } from './spaces.constants';
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

    const [spaces, sessionStats, dashboardSummaries, lastSettledMap] =
      await Promise.all([
        this.findSpacesByStore(storeId),
        this.summaryService.buildTodaySettledSessionStats(storeId),
        this.summaryService.buildDashboardSpaceSummaryBundle(storeId),
        this.buildLastSettledEndTimeMap(storeId),
      ]);

    return {
      stats: this.buildSpaceStats(spaces, sessionStats, lastSettledMap),
      filterOptions: this.buildFilterOptions(spaces),
      spaces: spaces.map((space) =>
        this.toSpaceDashboardItem(space, dashboardSummaries, lastSettledMap),
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
    lastSettledMap: Map<number, Date>,
  ): SpaceStatsResponseDto {
    let idle = 0;
    let occupied = 0;
    let reserved = 0;
    let cleaning = 0;

    for (const space of spaces) {
      const status = this.deriveSpaceStatus(space, lastSettledMap);
      switch (status) {
        case 'occupied':
          occupied += 1;
          break;
        case 'reserved':
          reserved += 1;
          break;
        case 'cleaning':
          cleaning += 1;
          break;
        default:
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

  /**
   * 查询每个空间最近一次 settled 会话的 endTime，用于脏房 cleaning 状态推导。
   *
   * 使用 DISTINCT ON 让 PostgreSQL 在数据库层面完成"每个 space 取最新一条"，
   * 避免加载全量 settled sessions 再在内存中过滤。
   *
   * 执行计划：DISTINCT ON + ORDER BY 可利用 (spaceId, endTime) 复合索引，
   * 实际仅需索引扫描，无需排序全表。若 storeId 下 settled sessions 较多，
   * 性能提升显著。
   */
  private async buildLastSettledEndTimeMap(
    storeId: number,
  ): Promise<Map<number, Date>> {
    type LastSettledRow = { spaceId: number; endTime: Date };
    const rows = await this.prisma.$queryRaw<LastSettledRow[]>`
      SELECT DISTINCT ON ("spaceId") "spaceId", "endTime"
      FROM "SpaceSession"
      WHERE "storeId" = ${storeId}
        AND status = 'settled'
        AND "endTime" IS NOT NULL
      ORDER BY "spaceId", "endTime" DESC
    `;

    const map = new Map<number, Date>();
    for (const row of rows) {
      map.set(row.spaceId, row.endTime);
    }
    return map;
  }

  private deriveSpaceStatus(
    space: Awaited<ReturnType<typeof this.findSpacesByStore>>[number],
    lastSettledMap: Map<number, Date>,
  ): SpaceStatusValue {
    if (space.sessions.length > 0) return 'occupied';
    if (space.reservations.length > 0) return 'reserved';

    // 脏房模式：结账后无活跃会话，且尚未标记清洁完成 → cleaning
    if (space.enableDirtyRoom) {
      const lastSettledEndTime = lastSettledMap.get(space.id) ?? null;
      if (lastSettledEndTime !== null) {
        const cleanedMs = space.cleanedAt?.getTime() ?? 0;
        if (lastSettledEndTime.getTime() > cleanedMs) return 'cleaning';
      }
    }

    return 'idle';
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
    lastSettledMap: Map<number, Date>,
  ): SpaceDashboardSpaceItemDto {
    const status = this.deriveSpaceStatus(space, lastSettledMap);

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
