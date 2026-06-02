import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StaffAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async ensureAccountCanOnlyBindSingleStore(
    storeId: number,
    email: string,
    userId?: number,
  ): Promise<void> {
    const [ownedStore, existingMembership] = await Promise.all([
      userId
        ? this.prisma.store.findFirst({
            where: {
              ownerId: userId,
              id: { not: storeId },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.staff.findFirst({
        where: {
          storeId: { not: storeId },
          isActive: true,
          OR: userId ? [{ email }, { userId }] : [{ email }],
        },
        select: { id: true, storeId: true },
      }),
    ]);

    if (ownedStore || existingMembership) {
      throw new ConflictException(
        '一个账号只能绑定一个门店，请先解除原门店关系',
      );
    }
  }

  async ensureCanManageStaff(
    user: AuthenticatedUser,
    storeId: number,
    requiredPermission: 'staff:create' | 'staff:update' | 'staff:delete',
  ): Promise<void> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      requiredPermission,
    );

    if (manageableStoreId !== storeId) {
      throw new ForbiddenException('无权操作该门店员工');
    }
  }

  async getManageableStoreId(
    user: AuthenticatedUser,
    requiredPermission:
      | 'staff:view'
      | 'staff:create'
      | 'staff:update'
      | 'staff:delete',
  ): Promise<number | null> {
    const currentStoreId =
      this.accessControlService.resolveCurrentStoreIdByPermission(
        user,
        requiredPermission,
      );
    if (currentStoreId !== null) {
      return currentStoreId;
    }

    return null;
  }

  async findManageableStaffOrThrow(
    user: AuthenticatedUser,
    staffId: number,
    requiredPermission: 'staff:update' | 'staff:delete',
  ): Promise<{ id: number; storeId: number; role: StaffRole }> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: staffId,
      },
      select: { id: true, storeId: true, role: true },
    });

    if (!staff) {
      throw new NotFoundException('员工不存在');
    }

    await this.ensureCanManageStaff(user, staff.storeId, requiredPermission);

    if (staff.role === StaffRole.OWNER) {
      throw new ForbiddenException('不能直接修改或删除老板身份');
    }

    return staff;
  }
}
