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
  businessMode?: 'catering' | 'general';
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
  'operation-entry:view',
  'operation-entry:create',
  'goods:view',
  // 空间管理（非餐饮门店收银员专用：查看空间列表/看板、操作会话/预约）
  'space:view',
  // 扫码点餐（餐饮门店收银员专用）
  'scan-ordering:view',
  'scan-ordering:table-manage',
  'scan-ordering:order-process',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const CATERING_MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  // 员工管理
  'staff:view',
  'staff:create',
  'staff:update',
  // 营销与报表（主账号专属，子账号不实际使用）
  'marketing:view',
  'marketing:manage',
  'report:view',
  // 商品与供应商管理
  'goods:view',
  'goods:create',
  'goods:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  // 进货管理
  'purchase:view',
  'purchase:create',
  // 成本与运营入口
  'cost:view',
  'operation-entry:view',
  'operation-entry:create',
  'operation-entry:delete',
  // 销售记录
  'sales:view',
  'sales:create',
  'sales:delete',
  // 库存管理
  'inventory:view',
  'inventory:update',
  // 扫码点餐（餐饮门店店长专用）
  'scan-ordering:view',
  'scan-ordering:table-manage',
  'scan-ordering:table-config',
  'scan-ordering:order-process',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  // 交班管理
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const GENERAL_MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  // 员工管理
  'staff:view',
  'staff:create',
  'staff:update',
  // 营销与报表（主账号专属，子账号不实际使用）
  'marketing:view',
  'marketing:manage',
  'report:view',
  // 商品与供应商管理
  'goods:view',
  'goods:create',
  'goods:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  // 进货管理
  'purchase:view',
  'purchase:create',
  // 成本与运营入口
  'cost:view',
  'operation-entry:view',
  'operation-entry:create',
  'operation-entry:delete',
  // 销售记录
  'sales:view',
  'sales:create',
  'sales:delete',
  // 库存管理
  'inventory:view',
  'inventory:update',
  // 空间管理（非餐饮门店店长专用）
  'space:view',
  'space:create',
  'space:update',
  'space:delete',
  // 技师提成（配置与明细，非餐饮门店店长专用）
  'commission:view',
  'commission:manage',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  // 交班管理
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
  // 技师提成（配置与明细，财务专用）
  'commission:view',
  'commission:manage',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  'handover:view',
  'handover:create',
  'handover:update',
] as const;

const SUB_ACCOUNT_ROLE_PERMISSIONS: Record<
  StoreSubAccountRole,
  | readonly string[]
  | ((businessMode?: 'catering' | 'general') => readonly string[])
> = {
  [StoreSubAccountRole.cashier]: CASHIER_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.finance]: FINANCE_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.manager]: (
    businessMode?: 'catering' | 'general',
  ): readonly string[] => {
    // 餐饮店长使用扫码点餐权限集合
    if (businessMode === 'catering') {
      return CATERING_MANAGER_SUB_ACCOUNT_PERMISSIONS;
    }
    // 非餐饮店长使用空间管理权限集合
    return GENERAL_MANAGER_SUB_ACCOUNT_PERMISSIONS;
  },
};

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
      businessMode,
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

    return finalPermissions.filter(
      (permission): permission is string => !permission.startsWith('handover:'),
    ) as string[];
  }
}
