import { StaffRole, StoreSubAccountRole } from '@prisma/client';

export const PERMISSION_WILDCARD = '*';

export const PERMISSION_CODES = [
  'store:view',
  'store:update',
  'subscription:view',
  'subscription:update',
  'staff:view',
  'staff:create',
  'staff:update',
  'staff:delete',
  'members:view',
  'members:create',
  'members:update',
  'partner:view',
  'partner:withdraw',
  'partner:review',
  'marketing:view',
  'marketing:manage',
  'finance:view',
  'finance:manage',
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
  'service-call:view',
  'service-call:process',
  'scan-ordering:view',
  'scan-ordering:table-manage',
  'scan-ordering:table-config',
  'scan-ordering:menu-manage',
  'scan-ordering:order-process',
  'scan-ordering:report-view',
  // 自助下单（非餐饮空间场景）
  'self-ordering:view',
  'self-ordering:menu-manage',
  'self-ordering:order-process',
  'commission:view',
  'commission:manage',
  // 客存（寄存商品/服务：餐饮与非餐饮门店通用）
  'custody:view',
  'custody:create',
  'custody:pickup',
  'custody:void',
  'custody:manage',
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

/**
 * 子账号「可参与交班」派生规则（唯一数据源，员工分配与槽位配置两条创建路径共用）：
 * - 财务视角不参与交班（仅保留 handover:view 只读审计查看，见 AccessControlService 过滤逻辑）；
 * - 收银员与店长默认可参与交班。
 */
export const deriveSubAccountCanUseHandover = (
  role: StoreSubAccountRole,
): boolean => role !== StoreSubAccountRole.finance;

export const STORE_SUB_ACCOUNT_ROLE_LABELS: Record<
  StoreSubAccountRole,
  string
> = {
  [StoreSubAccountRole.cashier]: '收银员',
  [StoreSubAccountRole.finance]: '财务',
  [StoreSubAccountRole.manager]: '店长',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, readonly string[]> = {
  [StaffRole.owner]: [PERMISSION_WILDCARD],
  [StaffRole.manager]: [
    'store:view',
    'store:update',
    'subscription:view',
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
    'finance:manage',
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
    'purchase:view',
    'purchase:create',
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
    'service-call:view',
    'service-call:process',
    'scan-ordering:view',
    'scan-ordering:table-manage',
    'scan-ordering:table-config',
    'scan-ordering:menu-manage',
    'scan-ordering:order-process',
    'scan-ordering:report-view',
    // 自助下单（非餐饮空间场景）
    'self-ordering:view',
    'self-ordering:menu-manage',
    'self-ordering:order-process',
    'commission:view',
    'commission:manage',
    // 客存（店长可发起存入、核销取出、作废与配置门店口径）
    'custody:view',
    'custody:create',
    'custody:pickup',
    'custody:void',
    'custody:manage',
  ],
  [StaffRole.staff]: [
    'store:view',
    'service-call:view',
    'subscription:view',
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
    // 自助下单（查看权限：非餐饮门店普通员工需实时接收新订单弹窗，与空间查看对齐）
    'self-ordering:view',
    // 客存（普通员工仅可查看台账，发起存入/核销/作废由店长与主账号完成）
    'custody:view',
  ],
};
