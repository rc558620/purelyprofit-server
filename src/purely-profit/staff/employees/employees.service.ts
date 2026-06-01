import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreSubAccountRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
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
    private readonly employeesDictionaryService: EmployeesDictionaryService,
    private readonly employeesProfileReadService: EmployeesProfileReadService,
    private readonly employeesProfileWriteService: EmployeesProfileWriteService,
    private readonly employeesLeaveService: EmployeesLeaveService,
    private readonly employeesShiftService: EmployeesShiftService,
    private readonly employeesPayrollService: EmployeesPayrollService,
    private readonly employeesShiftDefinitionService: EmployeesShiftDefinitionService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly storeSubAccountService: StoreSubAccountService,
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
  create(
    user: AuthenticatedUser,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesProfileWriteService.create(user, dto);
  }

  update(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesProfileWriteService.update(user, employeeId, dto);
  }

  resign(
    user: AuthenticatedUser,
    employeeId: number,
    dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesProfileWriteService.resign(user, employeeId, dto);
  }

  remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    return this.employeesProfileWriteService.remove(user, employeeId);
  }

  async updateSubAccount(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeSubAccountDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );
    const existingSubAccount =
      await this.storeSubAccountService.findAssignedSubAccountByEmployee(
        employee.storeId,
        employee.id,
      );
    const summary = await this.storeSubAccountService.getStoreSubAccountSummary(
      employee.storeId,
    );
    const availableSlot = existingSubAccount
      ? existingSubAccount.slotIndex
      : summary.slots.find((slot) => !slot.isAssigned)?.slotIndex;

    if (!availableSlot) {
      throw new BadRequestException(
        '当前门店暂无可分配的子账号槽位，请先提升子账号额度',
      );
    }

    await this.storeSubAccountService.updateSlot(employee.storeId, {
      slotIndex: availableSlot,
      role:
        dto.role === 'cashier'
          ? StoreSubAccountRole.cashier
          : dto.role === 'finance'
            ? StoreSubAccountRole.finance
            : StoreSubAccountRole.manager,
      employeeId: employee.id,
      canAccessHome: true,
      canUseHandover: dto.role !== 'finance',
      loginAccount: dto.loginAccount?.trim() || undefined,
      initialPassword: dto.password?.trim() || undefined,
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
  ): Promise<EmployeeShiftResponseDto[]> {
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

  listPayrolls(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollResponseDto[]> {
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
