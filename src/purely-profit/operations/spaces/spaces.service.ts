import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateSpaceDto,
  ListSpacesQueryDto,
  SpaceResponseDto,
  UpdateSpaceDto,
  UpdateSpaceStatusDto,
} from './dto/space.dto';
import { SpacesReadService } from './spaces-read.service';
import { SpacesWriteService } from './spaces-write.service';

@Injectable()
export class SpacesService {
  constructor(
    private readonly spacesReadService: SpacesReadService,
    private readonly spacesWriteService: SpacesWriteService,
  ) {}

  listSpaces(
    user: AuthenticatedUser,
    query: ListSpacesQueryDto,
    requestId?: string,
  ): Promise<SpaceResponseDto[]> {
    return this.spacesReadService.listSpaces(user, query, requestId);
  }

  createSpace(
    user: AuthenticatedUser,
    dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesWriteService.createSpace(user, dto);
  }

  updateSpace(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesWriteService.updateSpace(user, spaceId, dto);
  }

  removeSpace(user: AuthenticatedUser, spaceId: number): Promise<void> {
    return this.spacesWriteService.removeSpace(user, spaceId);
  }

  markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    return this.spacesWriteService.markSpaceReady(user, spaceId);
  }

  /**
   * @deprecated Space.status 已从 schema 移除，此方法已废弃。
   * 调用将抛出 GoneException，如需重置空间状态请使用 markSpaceReady。
   */
  updateSpaceStatus(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceStatusDto,
  ): Promise<never> {
    return this.spacesWriteService.updateSpaceStatus(user, spaceId, dto);
  }
}
