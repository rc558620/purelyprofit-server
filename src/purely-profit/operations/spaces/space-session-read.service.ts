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
    // B1 fix: 软删除空间不可查看会话，与 listSpaces 的 deletedAt: null 口径一致
    // 性能：空间存在性校验与会话查询合并为一次 findFirst（relation filter 保证
    // 只命中未删除空间上的 active 会话）。查不到时再补一次轻量空间校验，
    // 用于区分「空间不存在（404）」与「无活跃会话（返回 null）」。
    const session = await this.prisma.spaceSession.findFirst({
      where: {
        spaceId,
        status: PrismaSpaceSessionStatus.active,
        space: { deletedAt: null },
      },
      include: SPACE_SESSION_FULL_INCLUDE,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });

    if (!session) {
      const space = await this.prisma.space.findFirst({
        where: { id: spaceId, deletedAt: null },
        select: { id: true, storeId: true },
      });

      if (!space) {
        throw new NotFoundException('空间不存在');
      }

      // 与原顺序一致：空间存在但无活跃会话时，仍先鉴权再返回 null，
      // 避免越权请求通过 null/404 差异探测其他门店空间
      await this.commerceAccessService.ensureCanAccessStore(
        user,
        space.storeId,
        'space:view',
        '无权查看该门店空间会话',
      );

      return null;
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    return toSpaceSessionResponse(session);
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
    // P3 fix: 先鉴权后查询，与 getActiveSpaceSession / listSpaceSessions 的鉴权顺序一致
    // 性能：存在性检查与完整加载合并为一次 findFirst（relation filter 已保证
    // 只命中未删除空间上的会话），省掉一次串行往返。
    const session = await this.prisma.spaceSession.findFirst({
      where: {
        id: sessionId,
        space: { deletedAt: null },
      },
      include: SPACE_SESSION_FULL_INCLUDE,
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

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
