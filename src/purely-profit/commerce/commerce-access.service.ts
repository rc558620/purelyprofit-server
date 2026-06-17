import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';
import type { PermissionCode } from '../access-control/access-control.constants';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Injectable()
export class CommerceAccessService {
  constructor(private readonly accessControlService: AccessControlService) {}

  getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission: PermissionCode,
  ): Promise<number | null> {
    return Promise.resolve(
      this.accessControlService.resolveCurrentStoreIdByPermission(
        user,
        requiredPermission,
      ),
    );
  }

  async resolveViewStoreId(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
    requiredPermission: PermissionCode,
    forbiddenMessage: string,
  ): Promise<number | null> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );

    if (manageableStoreId === null) {
      if (requestedStoreId !== undefined) {
        throw new ForbiddenException(forbiddenMessage);
      }
      return null;
    }

    if (
      requestedStoreId !== undefined &&
      manageableStoreId !== requestedStoreId
    ) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return requestedStoreId ?? manageableStoreId;
  }

  async resolveSingleStoreId(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
    requiredPermission: PermissionCode,
    forbiddenMessage: string,
  ): Promise<number> {
    const storeId = await this.resolveViewStoreId(
      user,
      requestedStoreId,
      requiredPermission,
      forbiddenMessage,
    );

    if (storeId === null) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return storeId;
  }

  async ensureCanAccessStore(
    user: AuthenticatedUser,
    storeId: number,
    requiredPermission: PermissionCode,
    forbiddenMessage: string,
  ): Promise<void> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );

    if (manageableStoreId !== storeId) {
      throw new ForbiddenException(forbiddenMessage);
    }
  }

  findOperatorStaffIdForStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<number | null> {
    return Promise.resolve(
      this.accessControlService.resolveCurrentStaffIdForStore(user, storeId),
    );
  }
}
