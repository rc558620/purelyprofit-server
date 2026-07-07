import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import type { PermissionCode } from '../../access-control/access-control.constants';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

export type EmployeesPermission = Extract<
  PermissionCode,
  | 'staff:view'
  | 'staff:create'
  | 'staff:update'
  | 'report:view'
  | 'finance:view'
  | 'finance:manage'
>;

type EmployeesPermissionRequirement =
  | EmployeesPermission
  | readonly EmployeesPermission[];

@Injectable()
export class EmployeesAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  resolveViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
    permission: EmployeesPermissionRequirement = 'staff:view',
  ): Promise<number> {
    const manageableStoreId = this.getManageableStoreId(user, permission);

    if (manageableStoreId === null) {
      throw new ForbiddenException(forbiddenMessage);
    }

    if (storeId !== undefined && manageableStoreId !== storeId) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return Promise.resolve(storeId ?? manageableStoreId);
  }

  ensureCanManageEmployees(
    user: AuthenticatedUser,
    storeId: number,
    permission: EmployeesPermissionRequirement,
  ): Promise<void> {
    const manageableStoreId = this.getManageableStoreId(user, permission);
    if (manageableStoreId !== storeId) {
      throw new ForbiddenException('无权操作该门店员工档案');
    }

    return Promise.resolve();
  }

  getManageableStoreId(
    user: AuthenticatedUser,
    permission: EmployeesPermissionRequirement,
  ): number | null {
    for (const currentPermission of this.normalizePermissions(permission)) {
      const currentStoreId =
        this.accessControlService.resolveCurrentStoreIdByPermission(
          user,
          currentPermission,
        );
      if (currentStoreId !== null) {
        return currentStoreId;
      }
    }

    return null;
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
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
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
    permission: EmployeesPermissionRequirement,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    await this.ensureCanManageEmployees(user, employee.storeId, permission);
    return employee;
  }

  resolveSingleStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    permission: EmployeesPermissionRequirement,
  ): Promise<number> {
    const manageableStoreId = this.getManageableStoreId(user, permission);

    if (manageableStoreId === null) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }

    if (storeId !== undefined && manageableStoreId !== storeId) {
      throw new ForbiddenException('无权查看该门店数据');
    }

    return Promise.resolve(storeId ?? manageableStoreId);
  }

  ensureCanManageEmployeeSubAccount(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException('子账号无权管理员工子账号');
    }
  }

  buildEmployeeDetailCapabilities(
    user: AuthenticatedUser,
    storeId: number,
  ): {
    canViewSubAccountModule: boolean;
    canResign: boolean;
  } {
    return {
      canViewSubAccountModule:
        user.currentMembership?.subjectType !== 'sub_account',
      canResign:
        this.accessControlService.resolveCurrentStoreIdByPermission(
          user,
          'staff:update',
        ) === storeId,
    };
  }

  private normalizePermissions(
    permission: EmployeesPermissionRequirement,
  ): readonly EmployeesPermission[] {
    return typeof permission === 'string' ? [permission] : permission;
  }
}
