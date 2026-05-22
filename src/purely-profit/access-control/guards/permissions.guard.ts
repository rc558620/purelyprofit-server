import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlService } from '../access-control.service';
import type { PermissionCode } from '../access-control.constants';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCode[]
    >(REQUIRE_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: {
        currentMembership?: {
          permissions: string[];
          isActive: boolean;
        };
      };
    }>();

    const currentMembership = request.user?.currentMembership;

    if (!currentMembership || !currentMembership.isActive) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    const hasPermission = this.accessControlService.hasAnyPermission(
      currentMembership.permissions,
      requiredPermissions,
    );

    if (!hasPermission) {
      throw new ForbiddenException('当前账号缺少接口访问权限');
    }

    return true;
  }
}
