import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { buildPaginationMeta } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildSpaceSessionListWhere,
  buildStoreSpaceSessionListWhere,
} from './space-sessions.query-builder';
import {
  resolveSpaceSessionPageQuery,
  SPACE_SESSION_FULL_INCLUDE,
  toSpaceSessionListQuery,
} from './space-sessions.query';
import {
  ListSpaceSessionsQueryDto,
  type PaginatedSpaceSessionsResponseDto,
  type SpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import type {
  SpaceSessionListQuery,
  SpaceSessionRecord,
} from './space-sessions.types';

@Injectable()
export class SpaceSessionReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
    private readonly readStateService: SpaceSessionReadStateService,
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

    return this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery);
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

    return session ? toSpaceSessionResponse(session) : null;
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
    const { page, skip, take } = resolveSpaceSessionPageQuery(
      this.configService,
      normalizedQuery.page,
      normalizedQuery.pageSize,
    );
    const where = buildSpaceSessionListWhere(space.id, normalizedQuery);

    const queryResult: [SpaceSessionRecord[], number] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where,
        include: SPACE_SESSION_FULL_INCLUDE,
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.spaceSession.count({ where }),
    ]);

    const [sessions, total] = queryResult;

    return {
      items: sessions.map((session) => toSpaceSessionResponse(session)),
      meta: buildPaginationMeta(total, page, take),
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

    return toSpaceSessionResponse(session);
  }

  private async listStoreSpaceSessionsByQuery(
    storeId: number,
    query: SpaceSessionListQuery,
  ): Promise<SpaceSessionResponseDto[]> {
    const where = buildStoreSpaceSessionListWhere(storeId, query);

    const sessions = await this.prisma.spaceSession.findMany({
      where,
      include: SPACE_SESSION_FULL_INCLUDE,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    return sessions.map((session) => toSpaceSessionResponse(session));
  }
}
