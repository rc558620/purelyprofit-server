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
import { SUB_ACCOUNT_ROLE_PERMISSIONS } from './access-control.permission-sets';
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
  businessMode?: 'catering' | 'general';
  /** 会员护理档案档位（注册时确定）；undefined 表示未解析，能力层回源数据库 */
  memberCareEnabled?: boolean;
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

@Injectable()
export class AccessControlService {
  getEffectivePermissions(
    input: Pick<Staff, 'role' | 'permissions'> | AuthenticatedMembership,
    businessMode?: 'catering' | 'general',
  ): string[] {
    if ('subjectType' in input && input.subjectType === 'sub_account') {
      return this.getSubAccountPermissions(input, businessMode);
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
    businessMode?: 'catering' | 'general',
    memberCareEnabled?: boolean,
  ): AuthenticatedMembership {
    // 主账号（owner 员工行）优先：若店主本人也建有员工档案并绑定了子账号席位，
    // membership 行会 JOIN 出 sa.*，但身份必须保持 owner，
    // 否则会被子账号权限集（无 purchase:delete 等 owner 专属权限）降级导致 403
    const isOwnerStaff = staff.role === StaffRole.owner && staff.isActive;

    const subjectType: IdentityType =
      subAccount && !isOwnerStaff
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
      canAccessHome: isOwnerStaff
        ? true
        : subAccount
          ? (subAccount.canAccessHome ?? false)
          : true,
      canUseHandover: subAccount?.canUseHandover ?? false,
      businessMode,
      memberCareEnabled,
    };

    return {
      ...membership,
      permissions: this.getEffectivePermissions(membership, businessMode),
    };
  }

  private getSubAccountPermissions(
    membership: AuthenticatedMembership,
    businessMode?: 'catering' | 'general',
  ): string[] {
    if (
      membership.subAccountRole === null ||
      membership.subAccountStatus !== StoreSubAccountStatus.active ||
      !membership.subAccountAssigned ||
      !membership.canAccessHome
    ) {
      return [];
    }

    // 优先使用调用方传入的业态；未传入时回退到 membership 自身携带的业态，
    // 确保 capability / resolveCurrentStoreIdByPermission 等不传参调用也能正确解析店长权限集
    const effectiveBusinessMode = businessMode ?? membership.businessMode;

    let basePermissions =
      SUB_ACCOUNT_ROLE_PERMISSIONS[membership.subAccountRole] ?? [];

    // 如果是函数类型（店长），根据业态返回对应的权限集合
    if (typeof basePermissions === 'function') {
      basePermissions = basePermissions(effectiveBusinessMode);
    }

    const finalPermissions = Array.isArray(basePermissions)
      ? basePermissions
      : [];

    if (membership.canUseHandover) {
      return finalPermissions as string[];
    }

    // 不参与交班时回收交班权限：
    // - 财务视角例外：保留 handover:view 只读查看（交班记录审计：可查看/打印/导出，
    //   但不参与任何交班事务，交班附加项管理入口不显示）；
    // - 其他角色完全移除交班能力（无参与即无入口）。
    // 即使财务权限集被误加回 handover:create/update，也会在此被剔除，
    // 保证「财务不参与交班事务」在接口层最终生效。
    if (membership.subAccountRole === StoreSubAccountRole.finance) {
      return finalPermissions.filter(
        (permission): permission is string =>
          permission === 'handover:view' || !permission.startsWith('handover:'),
      ) as string[];
    }

    return finalPermissions.filter(
      (permission): permission is string => !permission.startsWith('handover:'),
    ) as string[];
  }
}
