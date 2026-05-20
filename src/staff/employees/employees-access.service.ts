import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, StaffStatus } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

export type EmployeesPermission =
  | 'staff:view'
  | 'staff:create'
  | 'staff:update'
  | 'report:view';

@Injectable()
export class EmployeesAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async resolveViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
    permission: EmployeesPermission = 'staff:view',
  ): Promise<number> {
    const manageableStoreId = await this.getManageableStoreId(
      user,
      permission,
    );

    if (manageableStoreId === null) {
      throw new ForbiddenException(forbiddenMessage);
    }

    if (storeId !== undefined && manageableStoreId !== storeId) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return storeId ?? manageableStoreId;
  }

  async ensureCanManageEmployees(
    user: AuthenticatedUser,
    storeId: number,
    permission: EmployeesPermission,
  ): Promise<void> {
    const manageableStoreId = await this.getManageableStoreId(user, permission);
    if (manageableStoreId !== storeId) {
      throw new ForbiddenException('无权操作该门店员工档案');
    }
  }

  async getManageableStoreId(
    user: AuthenticatedUser,
    permission: EmployeesPermission,
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
      permission,
    )
      ? staff.storeId
      : null;
  }

  async findEmployeeOrThrow(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<{
    id: number;
    storeId: number;
    empNo: string;
    status: EmployeeStatus;
  }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        storeId: true,
        empNo: true,
        status: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    await this.ensureCanManageEmployees(user, employee.storeId, 'staff:view');
    return employee;
  }

  async findManageableEmployeeOrThrow(
    user: AuthenticatedUser,
    employeeId: number,
    permission: 'staff:view' | 'staff:update',
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    await this.ensureCanManageEmployees(user, employee.storeId, permission);
    return employee;
  }

  async resolveSingleStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    permission: EmployeesPermission,
  ): Promise<number> {
    const manageableStoreId = await this.getManageableStoreId(user, permission);

    if (manageableStoreId === null) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    if (storeId !== undefined && manageableStoreId !== storeId) {
      throw new ForbiddenException('无权查看该门店数据');
    }

    return storeId ?? manageableStoreId;
  }
}
