import { Injectable, Logger } from '@nestjs/common';
import { SpaceReservationStatus, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
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

@Injectable()
export class SpacesReadService {
  private readonly logger = new Logger(SpacesReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
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
