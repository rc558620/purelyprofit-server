import { BadRequestException, Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import {
  DEFAULT_ROLE_PERMISSIONS,
  toStoreSubAccountRole,
} from '../../access-control/access-control.constants';
import { StaffRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountLoginService } from '../../member/platform-membership/store-sub-account-login.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  PaginatedEmployeePayrollsResponseDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeResponseDto,
  EmployeesOverviewQueryDto,
  EmployeesOverviewResponseDto,
  ListEmployeesQueryDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';
import {
  CreateEmployeeShiftDto,
  EmployeeShiftReportResponseDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
  PaginatedEmployeeShiftsResponseDto,
  UpdateEmployeeShiftDto,
} from './dto/employee-shift.dto';
import {
  CreateEmployeeShiftDefinitionDto,
  EmployeeShiftDefinitionResponseDto,
  UpdateEmployeeShiftDefinitionDto,
} from './dto/employee-shift-definition.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeSubAccountDto } from './dto/employee-sub-account.dto';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';
import { EmployeesProfileWriteService } from './employees-profile-write.service';
import { EmployeesLeaveService } from './employees-leave.service';
import { EmployeesShiftService } from './employees-shift.service';
import { EmployeesPayrollService } from './employees-payroll.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesDictionaryService: EmployeesDictionaryService,
    private readonly employeesProfileReadService: EmployeesProfileReadService,
    private readonly employeesProfileWriteService: EmployeesProfileWriteService,
    private readonly employeesLeaveService: EmployeesLeaveService,
    private readonly employeesShiftService: EmployeesShiftService,
    private readonly employeesPayrollService: EmployeesPayrollService,
    private readonly employeesShiftDefinitionService: EmployeesShiftDefinitionService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly storeSubAccountLoginService: StoreSubAccountLoginService,
  ) {}

  // dictionary
  listDepartments(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeeDepartmentResponseDto[]> {
    return this.employeesDictionaryService.listDepartments(user, query);
  }

  createDepartment(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesDictionaryService.createDepartment(user, dto);
  }

  updateDepartment(
    user: AuthenticatedUser,
    departmentId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesDictionaryService.updateDepartment(
      user,
      departmentId,
      dto,
    );
  }

  removeDepartment(
    user: AuthenticatedUser,
    departmentId: number,
  ): Promise<void> {
    return this.employeesDictionaryService.removeDepartment(user, departmentId);
  }

  listPositions(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeePositionResponseDto[]> {
    return this.employeesDictionaryService.listPositions(user, query);
  }

  createPosition(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesDictionaryService.createPosition(user, dto);
  }

  updatePosition(
    user: AuthenticatedUser,
    positionId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesDictionaryService.updatePosition(
      user,
      positionId,
      dto,
    );
  }

  removePosition(user: AuthenticatedUser, positionId: number): Promise<void> {
    return this.employeesDictionaryService.removePosition(user, positionId);
  }

  // profile read
  list(
    user: AuthenticatedUser,
    query: ListEmployeesQueryDto,
  ): Promise<PaginatedEmployeesResponseDto> {
    return this.employeesProfileReadService.list(user, query);
  }

  getOverview(
    user: AuthenticatedUser,
    query: EmployeesOverviewQueryDto,
  ): Promise<EmployeesOverviewResponseDto> {
    return this.employeesProfileReadService.getOverview(user, query);
  }

  getDetail(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeResponseDto> {
    return this.employeesProfileReadService.getDetail(user, employeeId);
  }

  // profile write
  async create(
    user: AuthenticatedUser,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const created = await this.employeesProfileWriteService.create(user, dto);
    return this.employeesProfileReadService.buildEmployeeDetail(
      user,
      Number(created.id),
      'staff:view',
    );
  }

  async update(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.employeesProfileWriteService.update(user, employeeId, dto);
    return this.employeesProfileReadService.buildEmployeeDetail(
      user,
      employeeId,
      'staff:view',
    );
  }

  async resign(
    user: AuthenticatedUser,
    employeeId: number,
    dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.employeesProfileWriteService.resign(user, employeeId, dto);
    return this.employeesProfileReadService.buildEmployeeDetail(
      user,
      employeeId,
      'staff:view',
    );
  }

  remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    return this.employeesProfileWriteService.remove(user, employeeId);
  }

  async updateSubAccount(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeSubAccountDto,
  ): Promise<EmployeeResponseDto> {
    this.employeesAccessService.ensureCanManageEmployeeSubAccount(user);

    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    // #8 修复：将槽位分配与登录账号创建纳入同一事务，避免孤立子账号
    await this.prisma.$transaction(async (tx) => {
      const existingSubAccount = await tx.storeSubAccount.findFirst({
        where: {
          storeId: employee.storeId,
          employeeId: employee.id,
          isAssigned: true,
        },
        select: { slotIndex: true },
      });

      let assignedSlotIndex: number | undefined;

      if (existingSubAccount) {
        // 缺陷4修复：CAS 原子更新已分配槽位，防止并发覆盖
        const casResult = await tx.storeSubAccount.updateMany({
          where: {
            storeId: employee.storeId,
            slotIndex: existingSubAccount.slotIndex,
            employeeId: employee.id,
            isAssigned: true,
          },
          data: {
            role: toStoreSubAccountRole(dto.role),
            status: 'active',
            assignedAt: new Date(),
            canAccessHome: true,
            canUseHandover: dto.role !== 'finance',
          },
        });
        if (casResult.count === 0) {
          throw new BadRequestException(
            '子账号槽位已被其他操作变更，请刷新后重试',
          );
        }
        assignedSlotIndex = existingSubAccount.slotIndex;
      } else {
        // 缺陷4修复：CAS 原子抢占空槽，防止并发串号
        const emptySlots = await tx.storeSubAccount.findMany({
          where: {
            storeId: employee.storeId,
            isAssigned: false,
            status: 'active',
          },
          select: { slotIndex: true },
          orderBy: { slotIndex: 'asc' },
        });

        for (const slot of emptySlots) {
          const casResult = await tx.storeSubAccount.updateMany({
            where: {
              storeId: employee.storeId,
              slotIndex: slot.slotIndex,
              isAssigned: false,
            },
            data: {
              role: toStoreSubAccountRole(dto.role),
              status: 'active',
              employeeId: employee.id,
              isAssigned: true,
              assignedAt: new Date(),
              canAccessHome: true,
              canUseHandover: dto.role !== 'finance',
            },
          });
          if (casResult.count > 0) {
            assignedSlotIndex = slot.slotIndex;
            break;
          }
        }
      }

      if (assignedSlotIndex === undefined) {
        throw new BadRequestException(
          '当前门店暂无可分配的子账号槽位，请先提升子账号额度',
        );
      }

      // 缺陷2修复：同步 Staff 角色与权限，使展示角色与真实登录权限同源
      // ── Bug 3 修复：移除冗余 storeId 过滤 ──
      // Employee.linkedStaffId 为 @unique，employeeProfile 条件已唯一定位 Staff。
      // 叠加 storeId 在 storeId 漂移时导致更新 0 行，角色与权限不同步。
      const staffRole =
        dto.role === 'manager' ? StaffRole.manager : StaffRole.staff;
      const staffPermissions = DEFAULT_ROLE_PERMISSIONS[staffRole];
      await tx.staff.updateMany({
        where: {
          employeeProfile: { is: { id: employee.id } },
        },
        data: {
          role: staffRole,
          permissions: [...staffPermissions],
        },
      });

      // 事务内创建/更新登录账号，失败时整个事务回滚
      await this.storeSubAccountLoginService.ensureEmployeeHasLoginAccount(
        employee.storeId,
        employee.id,
        {
          loginAccount: dto.loginAccount.trim(),
          password: dto.password.trim(),
        },
        tx,
      );
    });

    return this.employeesProfileReadService.buildEmployeeDetail(
      user,
      employeeId,
      'staff:update',
    );
  }

  // leave
  listLeaves(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeLeaveResponseDto[]> {
    return this.employeesLeaveService.listLeaves(user, employeeId);
  }

  createLeave(
    user: AuthenticatedUser,
    employeeId: number,
    dto: CreateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesLeaveService.createLeave(user, employeeId, dto);
  }

  updateLeave(
    user: AuthenticatedUser,
    leaveId: number,
    dto: UpdateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesLeaveService.updateLeave(user, leaveId, dto);
  }

  removeLeave(user: AuthenticatedUser, leaveId: number): Promise<void> {
    return this.employeesLeaveService.removeLeave(user, leaveId);
  }

  // shift definition
  listShiftDefinitions(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeeShiftDefinitionResponseDto[]> {
    return this.employeesShiftDefinitionService.listShiftDefinitions(
      user,
      query,
    );
  }

  createShiftDefinition(
    user: AuthenticatedUser,
    dto: CreateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesShiftDefinitionService.createShiftDefinition(
      user,
      dto,
    );
  }

  updateShiftDefinition(
    user: AuthenticatedUser,
    definitionId: number,
    dto: UpdateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesShiftDefinitionService.updateShiftDefinition(
      user,
      definitionId,
      dto,
    );
  }

  removeShiftDefinition(
    user: AuthenticatedUser,
    definitionId: number,
  ): Promise<void> {
    return this.employeesShiftDefinitionService.removeShiftDefinition(
      user,
      definitionId,
    );
  }

  // shift
  getShiftReport(
    user: AuthenticatedUser,
    query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftReportResponseDto> {
    return this.employeesShiftService.getShiftReport(user, query);
  }

  listShifts(
    user: AuthenticatedUser,
    query: ListEmployeeShiftsQueryDto,
  ): Promise<PaginatedEmployeeShiftsResponseDto> {
    return this.employeesShiftService.listShifts(user, query);
  }

  createShift(
    user: AuthenticatedUser,
    dto: CreateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesShiftService.createShift(user, dto);
  }

  updateShift(
    user: AuthenticatedUser,
    shiftId: number,
    dto: UpdateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesShiftService.updateShift(user, shiftId, dto);
  }

  removeShift(user: AuthenticatedUser, shiftId: number): Promise<void> {
    return this.employeesShiftService.removeShift(user, shiftId);
  }

  // payroll
  getPayrollReport(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollReportResponseDto> {
    return this.employeesPayrollService.getPayrollReport(user, query);
  }

  streamPayrollReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<void> {
    return this.employeesPayrollService.streamPayrollReportCsv(reply, user, query);
  }

  listPayrolls(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<PaginatedEmployeePayrollsResponseDto> {
    return this.employeesPayrollService.listPayrolls(user, query);
  }

  savePayroll(
    user: AuthenticatedUser,
    dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesPayrollService.savePayroll(user, dto);
  }

  confirmPayroll(
    user: AuthenticatedUser,
    payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesPayrollService.confirmPayroll(user, payrollId);
  }

  removePayroll(user: AuthenticatedUser, payrollId: number): Promise<void> {
    return this.employeesPayrollService.removePayroll(user, payrollId);
  }

  updatePayroll(
    user: AuthenticatedUser,
    payrollId: number,
    dto: UpdateEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesPayrollService.updatePayroll(user, payrollId, dto);
  }
}
