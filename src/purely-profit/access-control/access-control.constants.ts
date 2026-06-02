import { StaffRole, StoreSubAccountRole } from '@prisma/client';

export const PERMISSION_WILDCARD = '*';

export const PERMISSION_CODES = [
  'store:view',
  'store:update',
  'staff:view',
  'staff:create',
  'staff:update',
  'staff:delete',
  'staff:grant',
  'members:view',
  'members:create',
  'members:update',
  'partner:view',
  'partner:withdraw',
  'partner:review',
  'marketing:view',
  'marketing:manage',
  'finance:view',
  'finance:export',
  'cost:view',
  'cost:create',
  'cost:delete',
  'report:view',
  'goods:view',
  'goods:create',
  'goods:update',
  'goods:delete',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  'supplier:delete',
  'purchase:view',
  'purchase:create',
  'purchase:delete',
  'operation-entry:view',
  'operation-entry:create',
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

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const STORE_SUB_ACCOUNT_ROLE_CODES = [
  StoreSubAccountRole.cashier,
  StoreSubAccountRole.manager,
  StoreSubAccountRole.finance,
] as const;

export type StoreSubAccountRoleCode =
  (typeof STORE_SUB_ACCOUNT_ROLE_CODES)[number];

const STORE_SUB_ACCOUNT_ROLE_CODE_TO_PRISMA: Record<
  StoreSubAccountRoleCode,
  StoreSubAccountRole
> = {
  [StoreSubAccountRole.cashier]: StoreSubAccountRole.cashier,
  [StoreSubAccountRole.manager]: StoreSubAccountRole.manager,
  [StoreSubAccountRole.finance]: StoreSubAccountRole.finance,
};

const STORE_SUB_ACCOUNT_ROLE_PRISMA_TO_CODE: Record<
  StoreSubAccountRole,
  StoreSubAccountRoleCode
> = {
  [StoreSubAccountRole.cashier]: StoreSubAccountRole.cashier,
  [StoreSubAccountRole.manager]: StoreSubAccountRole.manager,
  [StoreSubAccountRole.finance]: StoreSubAccountRole.finance,
};

export function toStoreSubAccountRole(
  roleCode: StoreSubAccountRoleCode,
): StoreSubAccountRole {
  return STORE_SUB_ACCOUNT_ROLE_CODE_TO_PRISMA[roleCode];
}

export function toStoreSubAccountRoleCode(
  role: StoreSubAccountRole,
): StoreSubAccountRoleCode {
  return STORE_SUB_ACCOUNT_ROLE_PRISMA_TO_CODE[role];
}

export const STORE_SUB_ACCOUNT_ROLE_LABELS: Record<StoreSubAccountRole, string> = {
  [StoreSubAccountRole.cashier]: '收银员',
  [StoreSubAccountRole.finance]: '财务',
  [StoreSubAccountRole.manager]: '店长',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, readonly string[]> = {
  [StaffRole.OWNER]: [PERMISSION_WILDCARD],
  [StaffRole.MANAGER]: [
    'store:view',
    'store:update',
    'staff:view',
    'staff:create',
    'staff:update',
    'members:view',
    'members:create',
    'members:update',
    'partner:view',
    'partner:withdraw',
    'partner:review',
    'marketing:view',
    'marketing:manage',
    'finance:view',
    'cost:view',
    'cost:create',
    'cost:delete',
    'report:view',
    'goods:view',
    'goods:create',
    'goods:update',
    'supplier:view',
    'supplier:create',
    'supplier:update',
    'purchase:view',
    'purchase:create',
    'operation-entry:view',
    'operation-entry:create',
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
  ],
  [StaffRole.STAFF]: [
    'store:view',
    'members:view',
    'partner:view',
    'marketing:view',
    'cost:view',
    'report:view',
    'goods:view',
    'supplier:view',
    'purchase:view',
    'sales:view',
    'sales:create',
    'inventory:view',
    'space:view',
  ],
};
