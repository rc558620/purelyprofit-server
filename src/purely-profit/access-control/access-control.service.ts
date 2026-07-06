import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
  type Staff,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_WILDCARD,
  type PermissionCode,
} from './access-control.constants';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export type IdentityType = 'owner' | 'staff' | 'sub_account';

export interface AuthenticatedMembership {
  staffId: number;
  storeId: number;
  role: StaffRole;
  permissions: string[];
  isActive: boolean;
  subjectType: IdentityType;
  linkedEmployeeId: number | null;
  subAccountId: number | null;
  subAccountRole: StoreSubAccountRole | null;
  subAccountStatus: StoreSubAccountStatus | null;
  subAccountAssigned: boolean;
  canAccessHome: boolean;
  canUseHandover: boolean;
}

type MembershipStaffContext = Pick<
  Staff,
  'id' | 'storeId' | 'role' | 'permissions' | 'isActive'
> & {
  linkedEmployeeId?: number | null;
};

type MembershipSubAccountContext = {
  id: number;
  employeeId: number | null;
  role: StoreSubAccountRole;
  status: StoreSubAccountStatus;
  isAssigned: boolean;
  canAccessHome: boolean;
  canUseHandover: boolean;
} | null;

const CASHIER_SUB_ACCOUNT_PERMISSIONS = [
  'space:view',
  'space:create',
  'space:update',
  'operation-entry:view',
  'operation-entry:create',
  'goods:view',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  'staff:view',
  'staff:create',
  'staff:update',
  'marketing:view',
  'marketing:manage',
  'report:view',
  'goods:view',
  'goods:create',
  'goods:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  'purchase:view',
  'purchase:create',
  'cost:view',
  'operation-entry:view',
  'operation-entry:create',
  'operation-entry:delete',
  'sales:view',
  'sales:create',
  'sales:delete',
  'inventory:view',
  'inventory:update',
  'space:view',
  'space:create',
  'space:update',
  'space:delete',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const FINANCE_SUB_ACCOUNT_PERMISSIONS = [
  'finance:view',
  'finance:manage',
  'finance:export',
  'report:view',
  'goods:view',
  'inventory:view',
  'inventory:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  'purchase:view',
  'purchase:create',
  'cost:view',
  'cost:create',
  'cost:delete',
  'sales:view',
  'staff:view',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const SUB_ACCOUNT_ROLE_PERMISSIONS: Record<
  StoreSubAccountRole,
  readonly string[]
> = {
  [StoreSubAccountRole.cashier]: CASHIER_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.finance]: FINANCE_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.manager]: MANAGER_SUB_ACCOUNT_PERMISSIONS,
};

@Injectable()
export class AccessControlService {
  getEffectivePermissions(
    input: Pick<Staff, 'role' | 'permissions'> | AuthenticatedMembership,
  ): string[] {
    if ('subjectType' in input && input.subjectType === 'sub_account') {
      return this.getSubAccountPermissions(input);
    }

    const defaults = DEFAULT_ROLE_PERMISSIONS[input.role] ?? [];
    return Array.from(new Set([...defaults, ...input.permissions]));
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

  resolveCurrentStoreIdByPermission(
    user: Pick<AuthenticatedUser, 'currentMembership'>,
    requiredPermission: PermissionCode,
  ): number | null {
    const currentMembership = user.currentMembership;

    if (!currentMembership?.isActive) {
      return null;
    }

    const effectivePermissions =
      this.getEffectivePermissions(currentMembership);

    return this.hasPermission(effectivePermissions, requiredPermission)
      ? currentMembership.storeId
      : null;
  }

  resolveCurrentStaffIdForStore(
    user: Pick<AuthenticatedUser, 'currentMembership'>,
    storeId: number,
  ): number | null {
    const currentMembership = user.currentMembership;

    if (!currentMembership?.isActive || currentMembership.storeId !== storeId) {
      return null;
    }

    return currentMembership.staffId;
  }

  buildMembershipContext(
    staff: MembershipStaffContext,
    subAccount: MembershipSubAccountContext = null,
  ): AuthenticatedMembership {
    const subjectType: IdentityType = subAccount
      ? 'sub_account'
      : staff.role === StaffRole.owner
        ? 'owner'
        : 'staff';

    const membership: AuthenticatedMembership = {
      staffId: staff.id,
      storeId: staff.storeId,
      role: staff.role,
      permissions: staff.permissions,
      isActive: staff.isActive,
      subjectType,
      linkedEmployeeId:
        subAccount?.employeeId ?? staff.linkedEmployeeId ?? null,
      subAccountId: subAccount?.id ?? null,
      subAccountRole: subAccount?.role ?? null,
      subAccountStatus: subAccount?.status ?? null,
      subAccountAssigned: subAccount?.isAssigned ?? false,
      canAccessHome: subAccount ? (subAccount.canAccessHome ?? false) : true,
      canUseHandover: subAccount?.canUseHandover ?? false,
    };

    return {
      ...membership,
      permissions: this.getEffectivePermissions(membership),
    };
  }

  private getSubAccountPermissions(
    membership: AuthenticatedMembership,
  ): string[] {
    if (
      membership.subAccountRole === null ||
      membership.subAccountStatus !== StoreSubAccountStatus.active ||
      !membership.subAccountAssigned ||
      !membership.canAccessHome
    ) {
      return [];
    }

    const basePermissions =
      SUB_ACCOUNT_ROLE_PERMISSIONS[membership.subAccountRole] ?? [];
    if (membership.canUseHandover) {
      return basePermissions as string[];
    }

    return basePermissions.filter(
      (permission) => !permission.startsWith('handover:'),
    );
  }
}
