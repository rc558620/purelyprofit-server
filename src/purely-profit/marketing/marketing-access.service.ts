import { ForbiddenException, Injectable } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export type MarketingPermission = 'marketing:view' | 'marketing:manage';

@Injectable()
export class MarketingAccessService {
  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 获取当前用户可管理的门店 ID。
   * - 有权限 → 返回 storeId
   * - 无权限 → 返回 null
   */
  async getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission: MarketingPermission,
  ): Promise<number | null> {
    const currentStoreId =
      this.accessControlService.resolveCurrentStoreIdByPermission(
        user,
        requiredPermission,
      );
    if (currentStoreId !== null) {
      return currentStoreId;
    }

    if (!user.currentMembership) {
      return this.findLegacyOwnerStoreId(user.id);
    }

    const membershipStoreId = user.currentMembership.storeId;
    if (membershipStoreId === null || membershipStoreId === undefined) {
      return null;
    }

    const legacyOwnerStoreId = await this.findLegacyOwnerStoreId(user.id);
    if (legacyOwnerStoreId === null) {
      return null;
    }

    return membershipStoreId === legacyOwnerStoreId ? legacyOwnerStoreId : null;
  }

  private async findLegacyOwnerStoreId(userId: number): Promise<number | null> {
    const store = await this.prisma.store.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return store?.id ?? null;
  }

  private async canViewRequestedStore(
    userId: number,
    storeId: number,
  ): Promise<boolean> {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return false;
    }

    const store = await this.prisma.store.findFirst({
      where: {
        id: normalizedStoreId,
        deletedAt: null,
        OR: [{ ownerId: userId }],
      },
      select: { id: true },
    });

    if (store) {
      return true;
    }

    const staff = await this.prisma.staff.findFirst({
      where: {
        storeId: normalizedStoreId,
        userId,
        isActive: true,
        status: StaffStatus.active,
      },
      select: { id: true },
    });

    return staff !== null;
  }

  /**
   * 确保当前用户对指定门店拥有所需营销权限，否则抛 ForbiddenException。
   */
  async ensureCanAccess(
    user: AuthenticatedUser,
    storeId: number,
    requiredPermission: MarketingPermission,
  ): Promise<void> {
    const manageableId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );
    if (manageableId === storeId) {
      return;
    }

    if (await this.canViewRequestedStore(user.id, storeId)) {
      return;
    }

    throw new ForbiddenException('无权操作该门店的营销数据');
  }

  /**
   * 解析查询视图所属的门店 ID：
   * - 如果调用方传了 storeId（管理员视角），校验是否在权限范围内
   * - 如果未传，使用当前用户所属门店
   * - 无论如何都要有 marketing:view 权限
   */
  async resolveViewStoreId(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
    forbiddenMessage = '无权查看该门店的营销数据',
  ): Promise<number | null> {
    const manageableId = await this.getManageableStoreId(
      user,
      'marketing:view',
    );

    if (requestedStoreId !== undefined) {
      const normalizedRequestedStoreId = Number(requestedStoreId);
      if (
        !Number.isInteger(normalizedRequestedStoreId) ||
        normalizedRequestedStoreId <= 0
      ) {
        throw new ForbiddenException(forbiddenMessage);
      }

      if (manageableId === normalizedRequestedStoreId) {
        return normalizedRequestedStoreId;
      }

      const hasDirectAccess = await this.canViewRequestedStore(
        user.id,
        normalizedRequestedStoreId,
      );
      if (hasDirectAccess) {
        return normalizedRequestedStoreId;
      }

      throw new ForbiddenException(forbiddenMessage);
    }

    return manageableId;
  }
}
