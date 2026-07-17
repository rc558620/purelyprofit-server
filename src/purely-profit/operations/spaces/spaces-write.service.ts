import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import type {
  CreateSpaceDto,
  SpaceResponseDto,
  UpdateSpaceDto,
} from './dto/space.dto';
import { SpaceReservationsService } from './space-reservations.service';
import { SpacesRefResolverService } from './spaces-ref-resolver.service';
import { SpacesStatusService } from './spaces-status.service';
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
import { getReservationStatusRange } from './space-reservations.shared';

@Injectable()
export class SpacesWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly spacesRefResolverService: SpacesRefResolverService,
    private readonly spaceReservationsService: SpaceReservationsService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly spacesStatusService: SpacesStatusService,
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

    let created;
    try {
      created = await this.prisma.$transaction(
        async (transaction) => {
          // SPACE-MGMT-003 fix: FOR UPDATE 锁定同门店空间行，防止并发创建产生重复 sortOrder
          await transaction.$queryRaw`
            SELECT id
            FROM spaces
            WHERE store_id = ${storeId} AND deleted_at IS NULL
            FOR UPDATE
          `;

          const existingCount = await transaction.space.count({
            where: { storeId, deletedAt: null },
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
              sortOrder: targetSortOrder,
            },
            include: SPACE_WITH_RELATIONS_INCLUDE,
          });
        },
        { timeout: TX_TIMEOUT_SHORT },
      );
    } catch (err) {
      // SPACE-MGMT-001 fix: 并发创建同名空间触发 partial unique index 冲突，
      // 将 Prisma P2002 归一化为业务友好的 409 ConflictException
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('空间名称已存在');
      }
      throw err;
    }

    // 创建后推导运行态状态（新建空间通常无会话/预约，但与 updateSpace 保持一致的推导路径）
    const derivedStatus = await this.spacesStatusService.deriveSpaceStatus(
      created.id,
    );
    return toSpaceResponse({ ...created, status: derivedStatus });
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

    // 前置校验：空间存在活跃会话时禁止编辑，与 removeSpace 预检口径一致
    const activeSessionCount = await this.prisma.spaceSession.count({
      where: { spaceId: space.id, status: PrismaSpaceSessionStatus.active },
    });
    if (activeSessionCount > 0) {
      throw new ConflictException('空间当前使用中，无法进行编辑操作');
    }

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

    const updated = await this.prisma.$transaction(
      async (transaction) => {
        // B2 fix: 事务内 FOR UPDATE 后重新校验，消除 TOCTOU 竞态窗口
        await transaction.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${space.id}
          FOR UPDATE
        `;

        const activeSessions = await transaction.spaceSession.count({
          where: {
            spaceId: space.id,
            status: PrismaSpaceSessionStatus.active,
          },
        });
        if (activeSessions > 0) {
          throw new ConflictException('空间当前使用中，无法进行编辑操作');
        }

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
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    // 编辑空间配置后重新推导运行态状态
    const derivedStatus = await this.spacesStatusService.deriveSpaceStatus(
      updated.id,
    );
    return toSpaceResponse({ ...updated, status: derivedStatus });
  }

  async removeSpace(user: AuthenticatedUser, spaceId: number): Promise<void> {
    // 空间配置写操作仅允许主账号，子账号均被拒绝（同 createSpace）。
    this.ensurePrimaryAccountOnly(user);
    const space = await this.requireRemovableSpace(user, spaceId);

    // 有活跃会话（occupied），无法删除
    if (space._count.sessions > 0) {
      throw new ConflictException('空间使用中，无法删除');
    }

    if (space._count.reservations > 0) {
      throw new ConflictException('该空间存在待处理预约，请先取消预约后再删除');
    }

    await this.prisma.$transaction(
      async (transaction) => {
        // B2 fix: 事务内 FOR UPDATE 后重新校验，消除 TOCTOU 竞态窗口
        await transaction.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${space.id}
          FOR UPDATE
        `;

        const activeSessions = await transaction.spaceSession.count({
          where: { spaceId: space.id, status: PrismaSpaceSessionStatus.active },
        });
        if (activeSessions > 0) {
          throw new ConflictException('空间使用中，无法删除');
        }

        const pendingReservations = await transaction.spaceReservation.count({
          where: {
            spaceId: space.id,
            status: PrismaSpaceReservationStatus.pending,
            // B-3 fix: 事务内重查与外层预检口径一致，加 reservedAt 范围
            reservedAt: {
              gte: getReservationStatusRange().start,
              lte: getReservationStatusRange().end,
            },
          },
        });
        if (pendingReservations > 0) {
          throw new ConflictException(
            '该空间存在待处理预约，请先取消预约后再删除',
          );
        }

        // 软删除：更新 deletedAt 字段而非物理删除
        await transaction.space.update({
          where: { id: space.id },
          data: { deletedAt: new Date() },
        });

        await closeSortOrderGapAfterRemove(
          transaction,
          space.storeId,
          space.sortOrder,
        );
      },
      { timeout: TX_TIMEOUT_SHORT },
    );
  }

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    return this.spacesStatusService.markSpaceReady(user, spaceId);
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
}
