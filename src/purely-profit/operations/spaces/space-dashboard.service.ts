import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSpacesDashboardCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import {
  GetSpacesDashboardQueryDto,
  type SpaceDashboardFilterOptionsDto,
  type SpaceDashboardSpaceItemDto,
  type SpaceStatsResponseDto,
  type SpacesDashboardResponseDto,
} from './dto/space.dto';
import { toSpaceResponse } from './spaces.mapper';
import {
  deriveSpaceStatusFromCounts,
  getReservationStatusRange,
} from './space-reservations.shared';
import {
  SpaceDashboardSummaryService,
  type DashboardSpaceSummaryBundle,
} from './space-dashboard-summary.service';

/**
 * 看板缓存策略（与 sales-stats 同模式）：
 * 看板是轮询型页面，单次请求要跑 ~8 条 SQL（含当日销售三表聚合），
 * 命中缓存后降为 1 次 Redis GET。写路径（开台/结账/续费/换房/加单/
 * 标记可用/预约变更/空间增删改）主动失效，TTL 只兜底。
 */
const SPACES_DASHBOARD_CACHE_TTL_SECONDS = 15;
const SPACES_DASHBOARD_CACHE_REFRESH_AFTER_MS = 5_000;

@Injectable()
export class SpaceDashboardService {
  private readonly logger = new Logger(SpaceDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly summaryService: SpaceDashboardSummaryService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getSpacesDashboard(
    user: AuthenticatedUser,
    query: GetSpacesDashboardQueryDto,
    requestId?: string,
  ): Promise<SpacesDashboardResponseDto> {
    // BUG-07 fix: requestId 纳入日志，保证链路追踪可观测性
    this.logger.debug(
      requestId
        ? `getSpacesDashboard storeId=${query.storeId ?? '*'} requestId=${requestId}`
        : `getSpacesDashboard storeId=${query.storeId ?? '*'}`,
    );
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间看板',
    );

    if (storeId === null) {
      return this.buildEmptyDashboard();
    }

    const cacheKey = buildSpacesDashboardCacheKey(storeId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACES_DASHBOARD_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACES_DASHBOARD_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.buildDashboard(storeId),
    });
  }

  private async buildDashboard(
    storeId: number,
  ): Promise<SpacesDashboardResponseDto> {
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
    const statusRange = getReservationStatusRange();

    // Space.status 已移除，需要关联查询 session 和 reservation
    // 性能：只保留 _count（过滤条件与旧的嵌套 sessions/reservations 数组完全一致），
    // 由 _count 直接推导状态，省掉 2 条嵌套关系加载 SQL。
    return this.prisma.space.findMany({
      where: { storeId, deletedAt: null },
      include: {
        type: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        _count: {
          select: {
            sessions: { where: { status: 'active' } },
            reservations: {
              where: {
                status: 'pending',
                reservedAt: { gte: statusRange.start, lte: statusRange.end },
              },
            },
          },
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
      SELECT DISTINCT ON ("space_id") "space_id" AS "spaceId", "end_time" AS "endTime"
      FROM "space_sessions"
      WHERE "store_id" = ${storeId}
        AND status = 'settled'
        AND "end_time" IS NOT NULL
      ORDER BY "space_id", "end_time" DESC
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
  ): ReturnType<typeof deriveSpaceStatusFromCounts> {
    return deriveSpaceStatusFromCounts({
      activeSessions: space._count.sessions,
      pendingReservations: space._count.reservations,
      enableDirtyRoom: space.enableDirtyRoom,
      lastSettledEndTime: lastSettledMap.get(space.id) ?? null,
      cleanedAt: space.cleanedAt,
    });
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
