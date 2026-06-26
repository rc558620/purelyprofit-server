import { Injectable } from '@nestjs/common';
import { SpaceReservationStatus, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ListSpacesQueryDto, SpaceResponseDto } from './dto/space.dto';
import type { SpaceStatusValue } from './spaces.constants';
import { toSpaceResponse } from './spaces.mapper';
import {
  buildListSpacesWhere,
  SPACE_WITH_RELATIONS_INCLUDE,
} from './spaces.query';

/** 通过 _count 子查询推导空间运行态状态 */
function deriveStatusFromCounts(counts: {
  activeSessions: number;
  pendingReservations: number;
}): SpaceStatusValue {
  if (counts.activeSessions > 0) return 'occupied';
  if (counts.pendingReservations > 0) return 'reserved';
  return 'idle';
}

@Injectable()
export class SpacesReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listSpaces(
    user: AuthenticatedUser,
    query: ListSpacesQueryDto,
    requestId?: string,
  ): Promise<SpaceResponseDto[]> {
    void requestId;
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间列表',
    );

    if (storeId === null) {
      return [];
    }

    const spaces = await this.prisma.space.findMany({
      where: buildListSpacesWhere(storeId, query),
      include: {
        ...SPACE_WITH_RELATIONS_INCLUDE,
        _count: {
          select: {
            sessions: { where: { status: SpaceSessionStatus.active } },
            reservations: { where: { status: SpaceReservationStatus.pending } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    const responses = spaces.map((space) => {
      const status = deriveStatusFromCounts({
        activeSessions: space._count.sessions,
        pendingReservations: space._count.reservations,
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
