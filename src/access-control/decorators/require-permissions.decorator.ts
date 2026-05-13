import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../access-control.constants';

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
