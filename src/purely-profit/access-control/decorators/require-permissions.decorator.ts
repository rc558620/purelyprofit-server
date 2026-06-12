import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../access-control.constants';

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';
export const ALLOW_LEGACY_OWNER_ACCESS_KEY = 'allow_legacy_owner_access';

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);

export const AllowLegacyOwnerAccess = () =>
  SetMetadata(ALLOW_LEGACY_OWNER_ACCESS_KEY, true);
