import { Injectable, Logger } from '@nestjs/common';
import { SpaceReservationStatus, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSpacesListCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { ListSpacesQueryDto, SpaceResponseDto } from './dto/space.dto';
import { toSpaceResponse } from './spaces.mapper';
import {
  buildListSpacesWhere,
  SPACE_WITH_RELATIONS_INCLUDE,
} from './spaces.query';
import {
  deriveSpaceStatusFromCounts,
  getReservationStatusRange,
} from './space-reservations.shared';

/**
 * 列表缓存策略（与看板同模式）：
 * 空间列表含运行态推导（占用/预约/脏房），TTL 只兜底，一致性由写路径
 * invalidateSpacesReadCaches（开台/结账/续费/换房/加单/标记可用/预约变更/
 * 空间增删改）主动失效保证，属「有界陈旧」缓存。
 */
const SPACES_LIST_CACHE_TTL_SECONDS = 15;
const SPACES_LIST_CACHE_REFRESH_AFTER_MS = 5_000;

@Injectable()
export class SpacesReadService {
  private readonly logger = new Logger(SpacesReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async listSpaces(
    user: AuthenticatedUser,
    query: ListSpacesQueryDto,
    requestId?: string,
  ): Promise<SpaceResponseDto[]> {
    // BUG-07 fix: requestId 纳入日志，保证链路追踪可观测性
    this.logger.debug(
      requestId
        ? `listSpaces storeId=${query.storeId ?? '*'} requestId=${requestId}`
        : `listSpaces storeId=${query.storeId ?? '*'}`,
    );
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间列表',
    );

    if (storeId === null) {
      return [];
    }

    // 列表按 storeId + status/type/zone 分键，命中即跳过 3~6 条关系查询 SQL
    const cacheKey = buildSpacesListCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACES_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACES_LIST_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.loadSpacesList(storeId, query),
    });
  }

  private async loadSpacesList(
    storeId: number,
    query: ListSpacesQueryDto,
  ): Promise<SpaceResponseDto[]> {
    const statusRange = getReservationStatusRange();

    const spaces = await this.prisma.space.findMany({
      where: buildListSpacesWhere(storeId, query),
      include: {
        ...SPACE_WITH_RELATIONS_INCLUDE,
        _count: {
          select: {
            sessions: { where: { status: SpaceSessionStatus.active } },
            reservations: {
              where: {
                status: SpaceReservationStatus.pending,
                reservedAt: {
                  gte: statusRange.start,
                  lte: statusRange.end,
                },
              },
            },
          },
        },
        sessions: {
          // B7 fix: 过滤 endTime 为 null 的脏数据，与写路径 deriveSpaceStatus / resolveReservationBackStatus 口径一致
          where: { status: SpaceSessionStatus.settled, endTime: { not: null } },
          select: { endTime: true },
          orderBy: { endTime: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    const responses = spaces.map((space) => {
      const status = deriveSpaceStatusFromCounts({
        activeSessions: space._count.sessions,
        pendingReservations: space._count.reservations,
        enableDirtyRoom: space.enableDirtyRoom,
        lastSettledEndTime: space.sessions[0]?.endTime ?? null,
        cleanedAt: space.cleanedAt,
      });
      return toSpaceResponse({ ...space, status });
    });

    // 如果 query 有 status 过滤，在内存中做过滤
    if (query.status) {
      return responses.filter((r) => r.status === query.status);
    }

    return responses;
  }
}
