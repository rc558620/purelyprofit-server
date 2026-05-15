import { ForbiddenException, Injectable } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

export type MarketingPermission = 'marketing:view' | 'marketing:manage';

@Injectable()
export class MarketingAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
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
    const staff = await this.prisma.staff.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: user.email }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        storeId: true,
        role: true,
        permissions: true,
      },
      orderBy: { id: 'asc' },
    });

    if (!staff) {
      return null;
    }

    const effective = this.accessControlService.getEffectivePermissions(staff);
    return this.accessControlService.hasPermission(
      effective,
      requiredPermission,
    )
      ? staff.storeId
      : null;
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
    if (manageableId !== storeId) {
      throw new ForbiddenException('无权操作该门店的营销数据');
    }
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

    if (manageableId === null) {
      if (requestedStoreId !== undefined) {
        throw new ForbiddenException(forbiddenMessage);
      }
      return null;
    }

    if (requestedStoreId !== undefined && manageableId !== requestedStoreId) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return requestedStoreId ?? manageableId;
  }
}
