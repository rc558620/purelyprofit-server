import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
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
  toSpaceSessionListQuery,
} from './space-sessions.query';
import {
  ListSpaceSessionsQueryDto,
  type PaginatedSpaceSessionsResponseDto,
  type SpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
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
    private readonly settlementService: SpaceSessionSettlementService,
  ) {}

  async listStoreSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      queryDto.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    if (storeId === null) {
      return [];
    }

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      storeId,
      Date.now(),
      'space-sessions:list-store',
      requestId,
    );

    const query = toSpaceSessionListQuery(queryDto);
    const normalizedQuery: SpaceSessionListQuery = {
      ...query,
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };

    // 在默认查询 active 会话时，同步修复 occupied 空间的不一致状态
    if (normalizedQuery.status === PrismaSpaceSessionStatus.active) {
      await this.syncOccupiedSpaceStates(storeId);
    }

    return this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery);
  }

  async listStoreActiveSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      queryDto.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    if (storeId === null) {
      return [];
    }

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      storeId,
      Date.now(),
      'space-sessions:list-active',
      requestId,
    );

    const query = toSpaceSessionListQuery(queryDto);
    const normalizedQuery: SpaceSessionListQuery = {
      ...query,
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };

    return this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery);
  }

  async getActiveSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto | null> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
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

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      space.storeId,
      Date.now(),
      'space-sessions:get-active',
      requestId,
    );

    const session = await this.prisma.spaceSession.findFirst({
      where: {
        spaceId: space.id,
        status: PrismaSpaceSessionStatus.active,
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
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
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
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

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      space.storeId,
      Date.now(),
      'space-sessions:list-by-space',
      requestId,
    );

    const query = toSpaceSessionListQuery(queryDto);
    const { page, skip, take } = resolveSpaceSessionPageQuery(
      this.configService,
      query.page,
      query.pageSize,
    );
    const where = buildSpaceSessionListWhere(space.id, query);

    const queryResult: [SpaceSessionRecord[], number] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where,
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
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
    let session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
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

    if (session.status === PrismaSpaceSessionStatus.active) {
      await this.settlementService.autoCheckoutExpiredCountdownSessions(
        user,
        session.storeId,
        Date.now(),
        'space-sessions:detail',
        requestId,
      );

      session = await this.prisma.spaceSession.findUnique({
        where: { id: sessionId },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        throw new NotFoundException('空间会话不存在');
      }
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
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });

    return sessions.map((session) => toSpaceSessionResponse(session));
  }

  private async syncOccupiedSpaceStates(storeId: number): Promise<void> {
    // 查找所有 occupied 状态的空间
    const occupiedSpaces = await this.prisma.space.findMany({
      where: {
        storeId,
        status: PrismaSpaceStatus.occupied,
      },
      select: {
        id: true,
      },
    });

    if (occupiedSpaces.length === 0) {
      return;
    }

    // 对于每个 occupied 空间，检查是否存在 active session
    // 如果不存在，则自动修复状态
    for (const space of occupiedSpaces) {
      const activeSession = await this.prisma.spaceSession.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceSessionStatus.active,
        },
        select: { id: true },
      });

      if (!activeSession) {
        // 空间状态不一致，需要修复
        await this.fixInconsistentOccupiedSpace(space.id);
      }
    }
  }

  private async fixInconsistentOccupiedSpace(spaceId: number): Promise<void> {
    const todayRange = this.getTodayRange();

    await this.prisma.$transaction(async (transaction) => {
      // 检查是否有 pending 预约；如有则改为 reserved，否则改为 idle
      const hasTodayPendingReservation =
        await transaction.spaceReservation.findFirst({
          where: {
            spaceId,
            status: PrismaSpaceReservationStatus.pending,
            reservedAt: {
              gte: todayRange.start,
              lte: todayRange.end,
            },
          },
          select: { id: true },
        });

      const nextStatus = hasTodayPendingReservation
        ? PrismaSpaceStatus.reserved
        : PrismaSpaceStatus.idle;

      await transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
      });
    });
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
