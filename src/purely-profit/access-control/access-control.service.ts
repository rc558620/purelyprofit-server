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
  'sales:view',
  'sales:create',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  'members:view',
  'members:create',
  'members:update',
  'partner:view',
  'sales:view',
  'sales:create',
  'space:view',
  'space:create',
  'space:update',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const FINANCE_SUB_ACCOUNT_PERMISSIONS = [
  'finance:view',
  'finance:export',
  'report:view',
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

  buildMembershipContext(
    staff: MembershipStaffContext,
    subAccount: MembershipSubAccountContext = null,
  ): AuthenticatedMembership {
    const subjectType: IdentityType = subAccount
      ? 'sub_account'
      : staff.role === StaffRole.OWNER
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
      canAccessHome: subAccount?.canAccessHome ?? true,
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
      return [...basePermissions];
    }

    return basePermissions.filter(
      (permission) => !permission.startsWith('handover:'),
    );
  }
}
