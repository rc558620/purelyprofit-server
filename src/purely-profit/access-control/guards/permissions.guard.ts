import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessControlService } from '../access-control.service';
import type { PermissionCode } from '../access-control.constants';
import {
  ALLOW_LEGACY_OWNER_ACCESS_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCode[]
    >(REQUIRE_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const allowLegacyOwnerAccess = this.reflector.getAllAndOverride<boolean>(
      ALLOW_LEGACY_OWNER_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<{
      user?: {
        id?: number;
        currentMembership?: {
          permissions: string[];
          isActive: boolean;
          storeId?: number;
        };
      };
    }>();

    const currentMembership = request.user?.currentMembership;

    if (!currentMembership || !currentMembership.isActive) {
      if (
        allowLegacyOwnerAccess &&
        (await this.canAccessByLegacyOwner(request.user?.id, currentMembership))
      ) {
        return true;
      }
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    const hasPermission = this.accessControlService.hasAnyPermission(
      currentMembership.permissions,
      requiredPermissions,
    );

    if (!hasPermission) {
      if (
        allowLegacyOwnerAccess &&
        (await this.canAccessByLegacyOwner(request.user?.id, currentMembership))
      ) {
        return true;
      }
      throw new ForbiddenException('当前账号缺少接口访问权限');
    }

    return true;
  }

  private async canAccessByLegacyOwner(
    userId: number | undefined,
    currentMembership?: { storeId?: number } | undefined,
  ): Promise<boolean> {
    if (typeof userId !== 'number') {
      return false;
    }

    const store = await this.prisma.store.findFirst({
      where: { ownerId: userId },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    if (!store) {
      return false;
    }

    if (!currentMembership) {
      return true;
    }

    return currentMembership.storeId === store.id;
  }
}
