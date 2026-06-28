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

  async listStoreActiveSpaceSessions(
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

  async getActiveSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto | null> {
    void requestId;
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
        sessionItems: {
          select: {
            id: true,
            sessionId: true,
            productId: true,
            productName: true,
            categoryName: true,
            salePrice: true,
            profit: true,
            quantity: true,
            sortOrder: true,
            createdAt: true,
          },
        },
        sessionRenewRecords: {
          select: {
            id: true,
            sessionId: true,
            recordId: true,
            amount: true,
            addedMinutes: true,
            paymentMethod: true,
            grouponCode: true,
            grouponPlatform: true,
            voucherFaceAmount: true,
            note: true,
            renewedAt: true,
            createdAt: true,
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
    void requestId;
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
          sessionItems: {
            select: {
              id: true,
              sessionId: true,
              productId: true,
              productName: true,
              categoryName: true,
              salePrice: true,
              profit: true,
              quantity: true,
              sortOrder: true,
              createdAt: true,
            },
          },
          sessionRenewRecords: {
            select: {
              id: true,
              sessionId: true,
              recordId: true,
              amount: true,
              addedMinutes: true,
              paymentMethod: true,
              grouponCode: true,
              grouponPlatform: true,
              voucherFaceAmount: true,
              note: true,
              renewedAt: true,
              createdAt: true,
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
    void requestId;
    const session = await this.prisma.spaceSession.findUnique({
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
        sessionItems: {
          select: {
            id: true,
            sessionId: true,
            productId: true,
            productName: true,
            categoryName: true,
            salePrice: true,
            profit: true,
            quantity: true,
            sortOrder: true,
            createdAt: true,
          },
        },
        sessionRenewRecords: {
          select: {
            id: true,
            sessionId: true,
            recordId: true,
            amount: true,
            addedMinutes: true,
            paymentMethod: true,
            grouponCode: true,
            grouponPlatform: true,
            voucherFaceAmount: true,
            note: true,
            renewedAt: true,
            createdAt: true,
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
        sessionItems: {
          select: {
            id: true,
            sessionId: true,
            productId: true,
            productName: true,
            categoryName: true,
            salePrice: true,
            profit: true,
            quantity: true,
            sortOrder: true,
            createdAt: true,
          },
        },
        sessionRenewRecords: {
          select: {
            id: true,
            sessionId: true,
            recordId: true,
            amount: true,
            addedMinutes: true,
            paymentMethod: true,
            grouponCode: true,
            grouponPlatform: true,
            voucherFaceAmount: true,
            note: true,
            renewedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    return sessions.map((session) => toSpaceSessionResponse(session));
  }
}
