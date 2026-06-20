import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSpaceDto,
  SpaceResponseDto,
  UpdateSpaceDto,
  UpdateSpaceStatusDto,
} from './dto/space.dto';
import { SpaceReservationsService } from './space-reservations.service';
import { SpacesRefResolverService } from './spaces-ref-resolver.service';
import { toSpaceResponse } from './spaces.mapper';
import {
  closeSortOrderGapAfterRemove,
  ensureSpaceNameUnique,
  findManagedSpaceOrThrow,
  findSpaceRemovalCandidateOrThrow,
  normalizeTargetSortOrder,
  resolveManagedSpaceSortOrder,
  shiftSortOrdersForInsert,
  SPACE_WITH_RELATIONS_INCLUDE,
} from './spaces.query';
import type { ManagedSpaceRecord, SpaceRemovalCandidate } from './spaces.types';

@Injectable()
export class SpacesWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly spacesRefResolverService: SpacesRefResolverService,
    private readonly spaceReservationsService: SpaceReservationsService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async createSpace(
    user: AuthenticatedUser,
    dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    // 空间配置（新增 / 编辑 / 删除 / 状态重置）仅允许主账号（门店 Owner/Staff）操作。
    // 任何子账号身份（收银员 / 店长 / 财务）均被拒绝，与前端编辑模式区域的隐藏逻辑保持一致。
    this.ensurePrimaryAccountOnly(user);
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间',
    );
    const name = dto.name.trim();

    await this.platformMembershipAccessService.ensureSpaceQuotaAvailable(
      storeId,
    );
    await ensureSpaceNameUnique(this.prisma, { storeId, name });

    const refs = await this.spacesRefResolverService.resolveCreateSpaceRefs(
      storeId,
      dto,
    );

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
    // 空间配置写操作仅允许主账号，子账号均被拒绝（同 createSpace）。
    this.ensurePrimaryAccountOnly(user);
    const space = await this.requireUpdatableSpace(user, spaceId);
    const nextName = dto.name?.trim();

    if (nextName && nextName !== space.name) {
      await ensureSpaceNameUnique(this.prisma, {
        storeId: space.storeId,
        name: nextName,
        excludeSpaceId: space.id,
      });
    }

    const refs = await this.spacesRefResolverService.resolveUpdateSpaceRefs(
      space.storeId,
      dto,
    );

    const updated = await this.prisma.$transaction(async (transaction) => {
      const targetSortOrder = await resolveManagedSpaceSortOrder(
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
    // 空间配置写操作仅允许主账号，子账号均被拒绝（同 createSpace）。
    this.ensurePrimaryAccountOnly(user);
    const space = await this.requireRemovableSpace(user, spaceId);

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间使用中，无法删除');
    }

    if (space.status === PrismaSpaceStatus.cleaning) {
      throw new ConflictException('空间待清洁，无法删除');
    }

    if (space._count.reservations > 0) {
      throw new ConflictException('该空间存在待处理预约，请先取消预约后再删除');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.space.delete({
        where: { id: space.id },
      });

      await closeSortOrderGapAfterRemove(
        transaction,
        space.storeId,
        space.sortOrder,
      );
    });
  }

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    // 空间配置写操作仅允许主账号，子账号均被拒绝（同 createSpace）。
    this.ensurePrimaryAccountOnly(user);
    const space = await this.requireUpdatableSpace(user, spaceId);

    return this.updateSpaceStatusWithResolver(
      space.id,
      async (transaction) =>
        this.spaceReservationsService.resolveReservationBackStatus(
          transaction,
          space.id,
        ),
      {
        rejectIfOccupied: true,
      },
    );
  }

  async updateSpaceStatus(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceStatusDto,
  ): Promise<SpaceResponseDto> {
    // 空间配置写操作仅允许主账号，子账号均被拒绝（同 createSpace）。
    this.ensurePrimaryAccountOnly(user);
    const space = await this.requireUpdatableSpace(user, spaceId);

    this.ensureManualStatusChangeAllowed(space.status, dto.status);

    return this.updateSpaceStatusWithResolver(
      space.id,
      async (transaction) =>
        dto.status === PrismaSpaceStatus.cleaning
          ? PrismaSpaceStatus.cleaning
          : this.spaceReservationsService.resolveReservationBackStatus(
              transaction,
              space.id,
            ),
      {
        rejectIfOccupied: true,
        targetStatus: dto.status,
      },
    );
  }

  /**
   * 断言当前请求者为主账号（identityType 为 owner 或 staff）。
   * 空间配置类写操作（新增 / 编辑 / 删除 / 状态重置）属于门店运营配置，
   * 仅对绑定门店的主账号开放，任何子账号身份均不允许操作，以保持最小权限原则。
   * 前端已通过 isPrimaryAccount 隐藏编辑模式区域，此处为后端兜底校验。
   */
  private ensurePrimaryAccountOnly(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException('子账号不可维护空间配置');
    }
  }

  private async requireUpdatableSpace(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<ManagedSpaceRecord> {
    const space = await findManagedSpaceOrThrow(this.prisma, spaceId);

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
    const space = await findSpaceRemovalCandidateOrThrow(this.prisma, spaceId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:delete',
      '无权删除该门店空间',
    );

    return space;
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
    options?: {
      targetStatus?: PrismaSpaceStatus;
      rejectIfOccupied?: boolean;
    },
  ): Promise<SpaceResponseDto> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${spaceId}
        FOR UPDATE
      `;

      const latestSpace = await transaction.space.findUnique({
        where: { id: spaceId },
        select: {
          id: true,
          status: true,
        },
      });

      if (!latestSpace) {
        throw new ConflictException('空间不存在或已删除，请刷新后重试');
      }

      if (options?.targetStatus !== undefined) {
        this.ensureManualStatusChangeAllowed(
          latestSpace.status,
          options.targetStatus,
        );
      } else if (
        options?.rejectIfOccupied &&
        latestSpace.status === PrismaSpaceStatus.occupied
      ) {
        throw new ConflictException(
          '空间当前使用中，请先完成会话流程后再调整状态',
        );
      }

      const nextStatus = await resolveNextStatus(transaction);

      return transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
        include: SPACE_WITH_RELATIONS_INCLUDE,
      });
    });

    return toSpaceResponse(updated);
  }
}
