import { Injectable } from '@nestjs/common';
import type { StoreSubAccountRole } from '@prisma/client';
import type {
  AuthenticatedMembership,
  IdentityType,
} from './access-control.service';
import { AccessControlService } from './access-control.service';
import type { PermissionCode } from './access-control.constants';

export const PROFIT_HOME_MODULES = [
  'additional',
  'business-analysis',
  'finance-center',
  'goods-management',
  'handover-management',
  'marketing-center',
  'member-center',
  'space-management',
  'staff-management',
  'store-settings',
] as const;

export type ProfitHomeModule = (typeof PROFIT_HOME_MODULES)[number];

export interface SubjectCapabilitySnapshot {
  identityType: IdentityType;
  subAccountRole: StoreSubAccountRole | null;
  subAccountQuota: number;
  subAccountEnabled: boolean;
  allowedHomeModules: ProfitHomeModule[];
  hiddenHomeModules: ProfitHomeModule[];
  canViewFinance: boolean;
  canViewMarketing: boolean;
  canUseHandoverManagement: boolean;
  canUseSpaceManagement: boolean;
  canAccessStoreSettings: boolean;
}

const CASHIER_ALLOWED_HOME_MODULES: ProfitHomeModule[] = [
  'additional',
  'space-management',
  'handover-management',
];

const FINANCE_HIDDEN_HOME_MODULES = new Set<ProfitHomeModule>([
  'member-center',
  'marketing-center',
  'handover-management',
  'store-settings',
]);

@Injectable()
export class SubjectCapabilityService {
  constructor(private readonly accessControlService: AccessControlService) {}

  buildSnapshot(
    membership: AuthenticatedMembership | null,
    subAccountQuota: number,
  ): SubjectCapabilitySnapshot {
    const identityType = membership?.subjectType ?? 'staff';
    const effectivePermissions = membership?.permissions ?? [];
    const allowedHomeModules = this.resolveAllowedHomeModules(
      membership,
      effectivePermissions,
    );
    const hiddenHomeModules = PROFIT_HOME_MODULES.filter(
      (moduleName) => !allowedHomeModules.includes(moduleName),
    );

    return {
      identityType,
      subAccountRole: membership?.subAccountRole ?? null,
      subAccountQuota,
      subAccountEnabled: subAccountQuota > 0,
      allowedHomeModules,
      hiddenHomeModules,
      canViewFinance: allowedHomeModules.includes('finance-center'),
      canViewMarketing: allowedHomeModules.includes('marketing-center'),
      canUseHandoverManagement: allowedHomeModules.includes(
        'handover-management',
      ),
      canUseSpaceManagement: allowedHomeModules.includes('space-management'),
      canAccessStoreSettings: allowedHomeModules.includes('store-settings'),
    };
  }

  private resolveAllowedHomeModules(
    membership: AuthenticatedMembership | null,
    effectivePermissions: readonly string[],
  ): ProfitHomeModule[] {
    if (membership?.subjectType === 'sub_account') {
      return this.resolveSubAccountHomeModules(membership.subAccountRole);
    }

    const allowed = new Set<ProfitHomeModule>(['additional']);
    if (this.hasAnyPermission(effectivePermissions, ['report:view'])) {
      allowed.add('business-analysis');
    }
    if (
      this.hasAnyPermission(effectivePermissions, [
        'finance:view',
        'report:view',
      ])
    ) {
      allowed.add('finance-center');
    }
    if (
      this.hasAnyPermission(effectivePermissions, [
        'goods:view',
        'inventory:view',
        'purchase:view',
        'supplier:view',
      ])
    ) {
      allowed.add('goods-management');
    }
    if (this.hasAnyPermission(effectivePermissions, ['handover:view'])) {
      allowed.add('handover-management');
    }
    if (this.hasAnyPermission(effectivePermissions, ['marketing:view'])) {
      allowed.add('marketing-center');
    }
    if (
      this.hasAnyPermission(effectivePermissions, [
        'members:view',
        'partner:view',
      ])
    ) {
      allowed.add('member-center');
    }
    if (
      this.hasAnyPermission(effectivePermissions, [
        'space:view',
        'space:create',
        'space:update',
      ])
    ) {
      allowed.add('space-management');
    }
    if (this.hasAnyPermission(effectivePermissions, ['staff:view'])) {
      allowed.add('staff-management');
    }
    // store-settings 仅对非子账号开放，且需要相应权限
    // 子账号已在第 91-93 行提前返回，此处无需再判断 subjectType
    if (
      this.hasAnyPermission(effectivePermissions, [
        'store:view',
        'store:update',
      ])
    ) {
      allowed.add('store-settings');
    }

    return PROFIT_HOME_MODULES.filter((moduleName) => allowed.has(moduleName));
  }

  private resolveSubAccountHomeModules(
    subAccountRole: StoreSubAccountRole | null,
  ): ProfitHomeModule[] {
    if (subAccountRole === 'cashier') {
      return [...CASHIER_ALLOWED_HOME_MODULES];
    }

    if (subAccountRole === 'finance') {
      return PROFIT_HOME_MODULES.filter(
        (moduleName) => !FINANCE_HIDDEN_HOME_MODULES.has(moduleName),
      );
    }

    return [];
  }

  private hasAnyPermission(
    permissions: readonly string[],
    requiredPermissions: PermissionCode[],
  ): boolean {
    return this.accessControlService.hasAnyPermission(
      permissions,
      requiredPermissions,
    );
  }
}
