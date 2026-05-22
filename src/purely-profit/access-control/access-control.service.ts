import { Injectable } from '@nestjs/common';
import { StaffRole, type Staff } from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_WILDCARD,
  type PermissionCode,
} from './access-control.constants';

export interface AuthenticatedMembership {
  staffId: number;
  storeId: number;
  role: StaffRole;
  permissions: string[];
  isActive: boolean;
}

@Injectable()
export class AccessControlService {
  getEffectivePermissions(
    staff: Pick<Staff, 'role' | 'permissions'>,
  ): string[] {
    const defaults = DEFAULT_ROLE_PERMISSIONS[staff.role] ?? [];
    return Array.from(new Set([...defaults, ...staff.permissions]));
  }

  hasPermission(
    permissions: readonly string[],
    requiredPermission: PermissionCode,
  ): boolean {
    return (
      permissions.includes(PERMISSION_WILDCARD) ||
      permissions.includes(requiredPermission)
    );
  }

  hasAnyPermission(
    permissions: readonly string[],
    requiredPermissions: readonly PermissionCode[],
  ): boolean {
    return requiredPermissions.some((permission) =>
      this.hasPermission(permissions, permission),
    );
  }

  buildMembershipContext(
    staff: Pick<Staff, 'id' | 'storeId' | 'role' | 'permissions' | 'isActive'>,
  ): AuthenticatedMembership {
    return {
      staffId: staff.id,
      storeId: staff.storeId,
      role: staff.role,
      permissions: this.getEffectivePermissions(staff),
      isActive: staff.isActive,
    };
  }
}
