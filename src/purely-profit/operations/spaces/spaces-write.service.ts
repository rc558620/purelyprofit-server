import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSpaceDto,
  SpaceResponseDto,
  UpdateSpaceDto,
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
import type { SpaceStatusValue } from './spaces.constants';
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
    });

    // 新建空间始终为 idle（无 session，无 reservation）
    return toSpaceResponse({ ...created, status: 'idle' });
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

    // 编辑空间配置后重新推导运行态状态
    const derivedStatus = await this.deriveSpaceStatus(updated.id);
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

    await this.prisma.$transaction(async (transaction) => {
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
    });
  }

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    await this.requireUpdatableSpace(user, spaceId);

    // 标记清洁完成：更新 cleanedAt 时间戳，后续运行态推导将不再返回 cleaning
    await this.prisma.space.update({
      where: { id: spaceId },
      data: { cleanedAt: new Date() },
    });

    // 空间状态现由运行态推导（无 Space.status 字段），直接返回当前运行态
    const derivedStatus = await this.deriveSpaceStatus(spaceId);
    if (derivedStatus === 'occupied') {
      throw new ConflictException(
        '空间当前使用中，请先完成会话流程后再调整状态',
      );
    }

    const space = await this.prisma.space.findUniqueOrThrow({
      where: { id: spaceId },
      include: SPACE_WITH_RELATIONS_INCLUDE,
    });
    return toSpaceResponse({ ...space, status: derivedStatus });
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

  /**
   * 通过查询 SpaceSession 和 SpaceReservation 推导运行态状态
   * - occupied: 存在活跃会话（status=active）
   * - reserved: 存在待履约预约（status=pending）
   * - cleaning: enableDirtyRoom=true 且最后 settled 会话 endTime > cleanedAt
   * - idle: 其他情况
   */
  private async deriveSpaceStatus(spaceId: number): Promise<SpaceStatusValue> {
    const [activeSession, pendingReservation, space] = await Promise.all([
      this.prisma.spaceSession.findFirst({
        where: { spaceId, status: 'active' },
        select: { id: true },
      }),
      this.prisma.spaceReservation.findFirst({
        where: { spaceId, status: 'pending' },
        select: { id: true },
      }),
      this.prisma.space.findUnique({
        where: { id: spaceId },
        select: { enableDirtyRoom: true, cleanedAt: true },
      }),
    ]);

    if (activeSession) return 'occupied';
    if (pendingReservation) return 'reserved';

    // 脏房模式：结账后无活跃会话，且尚未标记清洁完成 → cleaning
    if (space?.enableDirtyRoom) {
      const lastSettled = await this.prisma.spaceSession.findFirst({
        where: { spaceId, status: 'settled', endTime: { not: null } },
        select: { endTime: true },
        orderBy: { endTime: 'desc' },
      });
      if (lastSettled?.endTime) {
        const cleanedMs = space.cleanedAt?.getTime() ?? 0;
        if (lastSettled.endTime.getTime() > cleanedMs) return 'cleaning';
      }
    }

    return 'idle';
  }
}
