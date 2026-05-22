import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSpaceDto,
  ListSpacesQueryDto,
  type SpaceResponseDto,
  UpdateSpaceDto,
  UpdateSpaceStatusDto,
} from './dto/space.dto';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceTypesService } from './space-types.service';
import { SpaceZonesService } from './space-zones.service';
import {
  buildListSpacesWhere,
  normalizeTargetSortOrder,
  reorderSpaceSortOrder,
  shiftSortOrdersForInsert,
  SPACE_WITH_RELATIONS_INCLUDE,
  type SpaceWithRelations,
  toSpaceResponse,
} from './spaces.constants';

interface ManagedSpaceRecord extends SpaceWithRelations {
  storeId: number;
}

interface SpaceRemovalCandidate {
  id: number;
  storeId: number;
  status: PrismaSpaceStatus;
  sortOrder: number;
  _count: {
    reservations: number;
  };
}

interface ResolvedCreateSpaceRefs {
  typeId: number;
  zoneId: number | null;
}

interface ResolvedUpdateSpaceRefs {
  typeId?: number;
  zoneId?: number | null;
}

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly spaceTypesService: SpaceTypesService,
    private readonly spaceZonesService: SpaceZonesService,
    private readonly spaceReservationsService: SpaceReservationsService,
  ) {}

  async listSpaces(
    user: AuthenticatedUser,
    query: ListSpacesQueryDto,
  ): Promise<SpaceResponseDto[]> {
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

  async createSpace(
    user: AuthenticatedUser,
    dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间',
    );
    const name = dto.name.trim();

    await this.ensureUniqueSpaceName(storeId, name);

    const refs = await this.resolveCreateSpaceRefs(storeId, dto);

    const created = await this.prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.space.count({
        where: { storeId },
      });
      const targetSortOrder = normalizeTargetSortOrder(
        dto.sortOrder,
        existingCount + 1,
      );

      await shiftSortOrdersForInsert(transaction, storeId, targetSortOrder);

      return transaction.space.create({
        data: {
          storeId,
          typeId: refs.typeId,
          zoneId: refs.zoneId,
          name,
          capacity: dto.capacity,
          enableDirtyRoom: dto.enableDirtyRoom,
          autoCheckout: dto.autoCheckout,
          status: PrismaSpaceStatus.idle,
          sortOrder: targetSortOrder,
        },
        include: SPACE_WITH_RELATIONS_INCLUDE,
      });
    });

    return toSpaceResponse(created);
  }

  async updateSpace(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    const space = await this.requireUpdatableSpace(user, spaceId);
    const nextName = dto.name?.trim();

    if (nextName && nextName !== space.name) {
      await this.ensureUniqueSpaceName(space.storeId, nextName, space.id);
    }

    const refs = await this.resolveUpdateSpaceRefs(space.storeId, dto);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const targetSortOrder = await this.resolveUpdateSortOrder(
        transaction,
        space,
        dto.sortOrder,
      );

      return transaction.space.update({
        where: { id: space.id },
        data: {
          ...(nextName ? { name: nextName } : {}),
          ...(refs.typeId !== undefined ? { typeId: refs.typeId } : {}),
          ...(refs.zoneId !== undefined ? { zoneId: refs.zoneId } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.enableDirtyRoom !== undefined
            ? { enableDirtyRoom: dto.enableDirtyRoom }
            : {}),
          ...(dto.autoCheckout !== undefined
            ? { autoCheckout: dto.autoCheckout }
            : {}),
          ...(targetSortOrder !== undefined
            ? { sortOrder: targetSortOrder }
            : {}),
        },
        include: SPACE_WITH_RELATIONS_INCLUDE,
      });
    });

    return toSpaceResponse(updated);
  }

  async removeSpace(user: AuthenticatedUser, spaceId: number): Promise<void> {
    const space = await this.requireRemovableSpace(user, spaceId);

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间使用中，无法删除');
    }

    if (space._count.reservations > 0) {
      throw new ConflictException('该空间存在待处理预约，请先取消预约后再删除');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.space.delete({
        where: { id: space.id },
      });

      await transaction.space.updateMany({
        where: {
          storeId: space.storeId,
          sortOrder: {
            gt: space.sortOrder,
          },
        },
        data: {
          sortOrder: {
            decrement: 1,
          },
        },
      });
    });
  }

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    const space = await this.requireUpdatableSpace(user, spaceId);

    return this.updateSpaceStatusWithResolver(space.id, async (transaction) =>
      this.spaceReservationsService.resolveReservationBackStatus(
        transaction,
        space.id,
      ),
    );
  }

  async updateSpaceStatus(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceStatusDto,
  ): Promise<SpaceResponseDto> {
    const space = await this.requireUpdatableSpace(user, spaceId);

    this.ensureManualStatusChangeAllowed(space.status, dto.status);

    return this.updateSpaceStatusWithResolver(space.id, async (transaction) =>
      dto.status === PrismaSpaceStatus.cleaning
        ? PrismaSpaceStatus.cleaning
        : this.spaceReservationsService.resolveReservationBackStatus(
            transaction,
            space.id,
          ),
    );
  }

  private async requireUpdatableSpace(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<ManagedSpaceRecord> {
    const space = await this.requireManagedSpace(spaceId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:update',
      '无权操作该门店空间',
    );

    return space;
  }

  private async requireRemovableSpace(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceRemovalCandidate> {
    const space = await this.requireSpaceRemovalCandidate(spaceId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:delete',
      '无权删除该门店空间',
    );

    return space;
  }

  private async requireManagedSpace(
    spaceId: number,
  ): Promise<ManagedSpaceRecord> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      include: SPACE_WITH_RELATIONS_INCLUDE,
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    return space;
  }

  private async requireSpaceRemovalCandidate(
    spaceId: number,
  ): Promise<SpaceRemovalCandidate> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
        status: true,
        sortOrder: true,
        _count: {
          select: {
            reservations: {
              where: {
                status: PrismaSpaceReservationStatus.pending,
              },
            },
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    return space;
  }

  private async resolveCreateSpaceRefs(
    storeId: number,
    dto: CreateSpaceDto,
  ): Promise<ResolvedCreateSpaceRefs> {
    const [type, zone] = await Promise.all([
      this.spaceTypesService.resolveSpaceTypeByName(storeId, dto.type),
      this.spaceZonesService.resolveSpaceZoneByName(storeId, dto.zone),
    ]);

    return {
      typeId: type.id,
      zoneId: zone?.id ?? null,
    };
  }

  private async resolveUpdateSpaceRefs(
    storeId: number,
    dto: UpdateSpaceDto,
  ): Promise<ResolvedUpdateSpaceRefs> {
    const [type, zone] = await Promise.all([
      dto.type !== undefined
        ? this.spaceTypesService.resolveSpaceTypeByName(storeId, dto.type)
        : Promise.resolve(null),
      dto.zone !== undefined
        ? this.spaceZonesService.resolveSpaceZoneByName(storeId, dto.zone)
        : Promise.resolve(null),
    ]);

    return {
      ...(dto.type !== undefined && type ? { typeId: type.id } : {}),
      ...(dto.zone !== undefined ? { zoneId: zone?.id ?? null } : {}),
    };
  }

  private resolveUpdateSortOrder(
    transaction: Prisma.TransactionClient,
    space: ManagedSpaceRecord,
    nextSortOrder: number | undefined,
  ): Promise<number | undefined> {
    if (nextSortOrder === undefined) {
      return Promise.resolve(undefined);
    }

    if (nextSortOrder === space.sortOrder) {
      return Promise.resolve(
        normalizeTargetSortOrder(nextSortOrder, space.sortOrder),
      );
    }

    return reorderSpaceSortOrder(
      transaction,
      space.storeId,
      space.id,
      space.sortOrder,
      nextSortOrder,
    );
  }

  private ensureManualStatusChangeAllowed(
    currentStatus: PrismaSpaceStatus,
    targetStatus: PrismaSpaceStatus,
  ): void {
    if (targetStatus === PrismaSpaceStatus.occupied) {
      throw new ConflictException('使用中状态仅可通过开台、换房等会话流程更新');
    }

    if (currentStatus === PrismaSpaceStatus.occupied) {
      throw new ConflictException(
        '空间当前使用中，请先完成会话流程后再调整状态',
      );
    }
  }

  private async updateSpaceStatusWithResolver(
    spaceId: number,
    resolveNextStatus: (
      transaction: Prisma.TransactionClient,
    ) => Promise<PrismaSpaceStatus>,
  ): Promise<SpaceResponseDto> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextStatus = await resolveNextStatus(transaction);

      return transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
        include: SPACE_WITH_RELATIONS_INCLUDE,
      });
    });

    return toSpaceResponse(updated);
  }

  private async ensureUniqueSpaceName(
    storeId: number,
    name: string,
    excludeSpaceId?: number,
  ): Promise<void> {
    const duplicate = await this.prisma.space.findFirst({
      where: {
        storeId,
        name,
        ...(excludeSpaceId !== undefined
          ? { id: { not: excludeSpaceId } }
          : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间名称已存在');
    }
  }
}
