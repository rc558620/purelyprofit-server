import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ListSpacesQueryDto, SpaceResponseDto } from './dto/space.dto';
import { toSpaceResponse } from './spaces.mapper';
import {
  buildListSpacesWhere,
  SPACE_WITH_RELATIONS_INCLUDE,
} from './spaces.query';
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
      include: SPACE_WITH_RELATIONS_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return spaces.map((space) => toSpaceResponse(space));
  }
}
