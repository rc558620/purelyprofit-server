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

/** 通过 _count 子查询 + 最近 settled 会话推导空间运行态状态 */
function deriveStatusFromCounts(params: {
  activeSessions: number;
  pendingReservations: number;
  enableDirtyRoom: boolean;
  lastSettledEndTime: Date | null;
  cleanedAt: Date | null;
}): SpaceStatusValue {
  if (params.activeSessions > 0) return 'occupied';
  if (params.pendingReservations > 0) return 'reserved';
  // 脏房模式：结账后无活跃会话，且尚未标记清洁完成 → cleaning
  if (params.enableDirtyRoom && params.lastSettledEndTime !== null) {
    const cleanedMs = params.cleanedAt?.getTime() ?? 0;
    if (params.lastSettledEndTime.getTime() > cleanedMs) return 'cleaning';
  }
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
        sessions: {
          where: { status: SpaceSessionStatus.settled },
          select: { endTime: true },
          orderBy: { endTime: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    const responses = spaces.map((space) => {
      const status = deriveStatusFromCounts({
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
