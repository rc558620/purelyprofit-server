import { ForbiddenException, Injectable } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import type { PermissionCode } from '../access-control/access-control.constants';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CommerceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission: PermissionCode,
  ): Promise<number | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: user.email }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        storeId: true,
        role: true,
        permissions: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (!staff) {
      return null;
    }

    const effectivePermissions =
      this.accessControlService.getEffectivePermissions(staff);
    return this.accessControlService.hasPermission(
      effectivePermissions,
      requiredPermission,
    )
      ? staff.storeId
      : null;
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

  async findOperatorStaffIdForStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<number | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        storeId,
        OR: [{ userId: user.id }, { email: user.email }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    return staff?.id ?? null;
  }
}
