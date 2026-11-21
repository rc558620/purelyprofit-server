import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { buildPaginationMeta } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSpaceSessionsSnapshotCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import {
  buildSpaceSessionListWhere,
  buildStoreSpaceSessionListWhere,
} from './space-sessions.query-builder';
import {
  SPACE_SESSION_FULL_INCLUDE,
  toSpaceSessionListQuery,
} from './space-sessions.query';
import {
  buildSpaceSessionListCursorWhere,
  encodeSpaceSessionListCursor,
  resolveSpaceSessionListPaging,
  SPACE_SESSION_LIST_ORDER_BY,
} from './space-sessions.cursor';
import {
  ListSpaceSessionsQueryDto,
  type PaginatedSpaceSessionsResponseDto,
  type SpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  maskSpaceSessionCommission,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import type {
  SpaceSessionListQuery,
  SpaceSessionRecord,
} from './space-sessions.types';

/**
 * 门店会话快照缓存策略（与看板 / 空间列表同模式）。
 *
 * GET /space-sessions 与 /space-sessions/active 是收银台轮询口，单次要带出
 * 全量 sessionItems + sessionRenewRecords（take 200），命中缓存后从
 * 「1 条主查询 + 2 条关系查询 + 数千行明细」降为 1 次 Redis GET。
 *
 * 一致性由写路径 invalidateSpacesReadCaches（开台 / 加单 / 续费 / 换房 /
 * 结账 / 标记可用 / 预约变更）主动失效保证，TTL 只兜底。
 * 快照里的 timeCost / itemsCost 均为落库快照值，实时滚动金额走 live-preview，
 * 因此本缓存不会让金额停滞。
 */
const SPACE_SESSIONS_SNAPSHOT_CACHE_TTL_SECONDS = 15;
const SPACE_SESSIONS_SNAPSHOT_CACHE_REFRESH_AFTER_MS = 5_000;

/** 搜索参数归一化：空串与未传等价，避免同一查询分裂出多个缓存键 */
const normalizeSearchTerm = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

@Injectable()
export class SpaceSessionReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
    private readonly readStateService: SpaceSessionReadStateService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  /**
   * 门店维度会话列表的规范实现。
   * P3 fix: listStoreActiveSpaceSessions 已合并到此方法，避免代码重复导致改一处漏改另一处。
   */
  async listStoreSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    void requestId;
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      queryDto.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    if (storeId === null) {
      return [];
    }

    const query = toSpaceSessionListQuery(queryDto);
    const normalizedQuery: SpaceSessionListQuery = {
      ...query,
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };

    const [sessions, canViewCommission] = await Promise.all([
      this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery),
      this.canViewSessionCommission(user, storeId),
    ]);
    // 缓存里存的是含金额的完整快照，命中后再按权限裁剪，避免污染缓存
    return canViewCommission
      ? sessions
      : sessions.map((session) => maskSpaceSessionCommission(session));
  }

  /**
   * @deprecated 与 listStoreSpaceSessions 逻辑完全相同，请直接使用 listStoreSpaceSessions。
   * 保留仅为兼容 controller 路由 /space-sessions/active，内部直接委托给 listStoreSpaceSessions。
   */
  async listStoreActiveSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    return this.listStoreSpaceSessions(user, queryDto, requestId);
  }

  async getActiveSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto | null> {
    void requestId;
    // 先按登录态解析门店归属，再用 storeId 限定后续查询：越权访问与「不存在」
    // 统一落到 404，不产生 404/403 差异，也不会泄露他店空间/会话是否存在。
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看该门店空间会话',
    );

    // B1 fix: 软删除空间不可查看会话，与 listSpaces 的 deletedAt: null 口径一致
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, storeId, deletedAt: null },
      select: { id: true },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    const session = await this.prisma.spaceSession.findFirst({
      where: {
        spaceId,
        storeId,
        status: PrismaSpaceSessionStatus.active,
        space: { deletedAt: null },
      },
      include: SPACE_SESSION_FULL_INCLUDE,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });

    return session
      ? toSpaceSessionResponse(session, {
          canViewCommission: await this.canViewSessionCommission(user, storeId),
        })
      : null;
  }

  async listSpaceSessions(
    user: AuthenticatedUser,
    spaceId: number,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<PaginatedSpaceSessionsResponseDto> {
    void requestId;
    // B1 fix: 软删除空间不可查看会话列表，与 listSpaces 的 deletedAt: null 口径一致
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    const query = toSpaceSessionListQuery(queryDto);
    // B2 fix: 空间维度与门店维度默认 status 口径统一为 active，
    // 避免同一模块两处入口数据范围相反导致“列表为空/数据对不上”的误判。
    const normalizedQuery: SpaceSessionListQuery = {
      ...query,
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };
    // 入参校验先于取数：cursor 非法时直接 400，不白跑一次查询
    const paging = resolveSpaceSessionListPaging(this.configService, queryDto);
    const baseWhere = buildSpaceSessionListWhere(space.id, normalizedQuery);
    // total 恒为全量口径：COUNT 只带筛选条件，不含游标，否则翻页时总数会变小
    const listWhere = paging.cursor
      ? { AND: [baseWhere, buildSpaceSessionListCursorWhere(paging.cursor)] }
      : baseWhere;

    const queryResult: [SpaceSessionRecord[], number] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where: listWhere,
        include: SPACE_SESSION_FULL_INCLUDE,
        orderBy: SPACE_SESSION_LIST_ORDER_BY,
        // 游标路径不需要 skip：where 已排除游标之前的行；offset 路径保留旧语义
        ...(paging.cursor ? {} : { skip: paging.offset }),
        // 游标路径多取一行做「是否还有下一页」探测，省掉一次额外查询
        take: paging.cursor ? paging.limit + 1 : paging.limit,
      }),
      this.prisma.spaceSession.count({ where: baseWhere }),
    ]);

    const [fetchedSessions, total] = queryResult;
    const sessions = paging.cursor
      ? fetchedSessions.slice(0, paging.limit)
      : fetchedSessions;
    // 游标路径靠探测行判定到底；offset 路径没有探测行，改用 offset + 已取条数 < total
    const hasMore = paging.cursor
      ? fetchedSessions.length > paging.limit
      : paging.offset + sessions.length < total;
    const lastSession = sessions.at(-1);

    const canViewCommission = await this.canViewSessionCommission(
      user,
      space.storeId,
    );

    return {
      items: sessions.map((session) =>
        toSpaceSessionResponse(session, { canViewCommission }),
      ),
      meta: buildPaginationMeta(total, paging.page, paging.limit),
      hasMore,
      nextCursor:
        hasMore && lastSession
          ? encodeSpaceSessionListCursor(lastSession)
          : null,
    };
  }

  async getSpaceSessionDetail(
    user: AuthenticatedUser,
    sessionId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto> {
    void requestId;
    // 先鉴权后查询：把当前登录门店直接作为查询条件，越权与不存在统一返回 404，
    // 避免通过 404/403 差异枚举他店会话 ID。
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看该门店空间会话',
    );

    const session = await this.prisma.spaceSession.findFirst({
      where: {
        id: sessionId,
        storeId,
        space: { deletedAt: null },
      },
      include: SPACE_SESSION_FULL_INCLUDE,
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    return toSpaceSessionResponse(session, {
      canViewCommission: await this.canViewSessionCommission(user, storeId),
    });
  }

  /** 会话里的提成金额与提成配置/明细同一权限口径（commission:view）。 */
  private async canViewSessionCommission(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<boolean> {
    return this.commerceAccessService.canAccessStoreWithPermission(
      user,
      storeId,
      'commission:view',
    );
  }

  private async listStoreSpaceSessionsByQuery(
    storeId: number,
    query: SpaceSessionListQuery,
  ): Promise<SpaceSessionResponseDto[]> {
    const cacheKey = buildSpaceSessionsSnapshotCacheKey(storeId, {
      status: query.status,
      keyword: normalizeSearchTerm(query.keyword),
      guestName: normalizeSearchTerm(query.guestName),
      guestPhone: normalizeSearchTerm(query.guestPhone),
      spaceName: normalizeSearchTerm(query.spaceName),
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACE_SESSIONS_SNAPSHOT_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACE_SESSIONS_SNAPSHOT_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.loadStoreSpaceSessionsByQuery(storeId, query),
    });
  }

  private async loadStoreSpaceSessionsByQuery(
    storeId: number,
    query: SpaceSessionListQuery,
  ): Promise<SpaceSessionResponseDto[]> {
    const where = buildStoreSpaceSessionListWhere(storeId, query);

    const sessions = await this.prisma.spaceSession.findMany({
      where,
      include: SPACE_SESSION_FULL_INCLUDE,
      // 门店维度仍是「活跃会话快照」（裸数组 + take 200，不分页），
      // 排序与分页列表共用同一份 orderBy 常量，避免两处排序键漂移
      orderBy: SPACE_SESSION_LIST_ORDER_BY,
      take: 200,
    });

    return sessions.map((session) => toSpaceSessionResponse(session));
  }
}
