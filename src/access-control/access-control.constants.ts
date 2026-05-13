import { StaffRole } from '@prisma/client';

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
  'marketing:view',
  'marketing:manage',
  'finance:view',
  'finance:export',
  'report:view',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

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
    'marketing:view',
    'marketing:manage',
    'finance:view',
    'report:view',
  ],
  [StaffRole.STAFF]: [
    'store:view',
    'members:view',
    'marketing:view',
    'report:view',
  ],
};
