import { Injectable } from '@nestjs/common';
import {
  EmployeePayrollStatus,
  Prisma,
  type Employee,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { CostsService } from '../../operations/costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeResponseDto } from './dto/employee-response.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import {
  buildCreateEmployeeProfileData,
  buildNextEmployeeEmpNo,
  buildResignEmployeeProfileData,
  buildUpdateEmployeeProfileData,
} from './employees-profile.domain';
import { buildPayrollDerivedAmounts } from './employees.domain';
import { toEmployeeResponse } from './employees.mapper';
import {
  createEmployeeProfile,
  queryLatestEmployeeProfileEmpNo,
  updateEmployeeProfile,
} from './employees-profile.query';
import { toDecimalNumber } from './employees.utils';

@Injectable()
export class EmployeesProfileWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly employeesDictionaryService: EmployeesDictionaryService,
    private readonly costsService: CostsService,
    private readonly cacheInvalidator: CacheInvalidatorService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const storeId = await this.resolveManageableStoreId(
      user,
      dto.storeId,
      'staff:create',
    );

    await this.platformMembershipAccessService.ensureEmployeeQuotaAvailable(
      storeId,
    );
    const [department, position, latestEmpNo] = await Promise.all([
      this.employeesDictionaryService.ensureDepartment(storeId, dto.department),
      this.employeesDictionaryService.ensurePosition(storeId, dto.position),
      queryLatestEmployeeProfileEmpNo(this.prisma, storeId),
    ]);
    const employee = await createEmployeeProfile(
      this.prisma,
      buildCreateEmployeeProfileData({
        storeId,
        department,
        position,
        empNo: buildNextEmployeeEmpNo(latestEmpNo),
        name: dto.name,
        phone: dto.phone,
        joinDate: dto.joinDate,
        baseSalary: dto.baseSalary,
        avatar: dto.avatar,
        idCard: dto.idCard,
        gender: dto.gender,
        emergencyContact: dto.emergencyContact,
        emergencyPhone: dto.emergencyPhone,
        contractEndDate: dto.contractEndDate,
        note: dto.note,
      }),
    );

    return toEmployeeResponse(employee);
  }

  async update(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const [department, position] = await Promise.all([
      dto.department
        ? this.employeesDictionaryService.ensureDepartment(
            employee.storeId,
            dto.department,
          )
        : Promise.resolve(undefined),
      dto.position
        ? this.employeesDictionaryService.ensurePosition(
            employee.storeId,
            dto.position,
          )
        : Promise.resolve(undefined),
    ]);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextEmployee = await transaction.employee.update({
        where: { id: employee.id },
        data: buildUpdateEmployeeProfileData({
          department,
          position,
          name: dto.name,
          phone: dto.phone,
          joinDate: dto.joinDate,
          baseSalary: dto.baseSalary,
          avatar: dto.avatar,
          idCard: dto.idCard,
          gender: dto.gender,
          emergencyContact: dto.emergencyContact,
          emergencyPhone: dto.emergencyPhone,
          contractEndDate: dto.contractEndDate,
          note: dto.note,
        }),
      });

      await this.syncEmployeeDependentSnapshots(
        transaction,
        employee,
        nextEmployee,
        dto,
        user.currentMembership?.staffId ?? null,
      );

      return nextEmployee;
    });

    await this.cacheInvalidator.invalidateProfitDashboardHome(employee.storeId);

    return toEmployeeResponse(updated);
  }

  async resign(
    user: AuthenticatedUser,
    employeeId: number,
    dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const resigned = await updateEmployeeProfile(
      this.prisma,
      employee.id,
      buildResignEmployeeProfileData(dto),
    );

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    await this.prisma.employee.delete({
      where: { id: employee.id },
    });
  }

  private async resolveManageableStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    permission: 'staff:create' | 'staff:update',
  ): Promise<number> {
    return this.employeesAccessService.resolveSingleStoreId(
      user,
      storeId,
      permission,
    );
  }

  private async syncEmployeeDependentSnapshots(
    transaction: Prisma.TransactionClient,
    previousEmployee: Employee,
    nextEmployee: Employee,
    dto: UpdateEmployeeDto,
    operatorStaffId: number | null,
  ): Promise<void> {
    const nameChanged =
      dto.name !== undefined && previousEmployee.name !== nextEmployee.name;
    const phoneChanged =
      dto.phone !== undefined && previousEmployee.phone !== nextEmployee.phone;
    const baseSalaryChanged =
      dto.baseSalary !== undefined &&
      previousEmployee.baseSalary.toString() !== nextEmployee.baseSalary.toString();

    if (!nameChanged && !phoneChanged && !baseSalaryChanged) {
      return;
    }

    if (nameChanged) {
      await Promise.all([
        transaction.employeeLeave.updateMany({
          where: { employeeId: nextEmployee.id },
          data: { employeeName: nextEmployee.name },
        }),
        transaction.employeeShift.updateMany({
          where: { employeeId: nextEmployee.id },
          data: { employeeName: nextEmployee.name },
        }),
      ]);
    }

    await this.syncLinkedStaffIdentity(
      transaction,
      nextEmployee,
      nameChanged,
      phoneChanged,
    );

    if (!baseSalaryChanged) {
      await Promise.all([
        this.syncEmployeePayrollNames(transaction, nextEmployee, nameChanged),
        this.syncPayrollCostTitles(
          transaction,
          previousEmployee,
          nextEmployee,
          nameChanged,
        ),
      ]);
      return;
    }

    const payrolls = await transaction.employeePayroll.findMany({
      where: { employeeId: nextEmployee.id },
      select: {
        id: true,
        month: true,
        status: true,
        leaveDeduction: true,
        otherDeduction: true,
        otherDeductionNote: true,
        bonus: true,
        socialInsurance: true,
        housingFund: true,
        note: true,
      },
    });

    await Promise.all(
      payrolls.map(async (payroll) => {
        const derivedAmounts = buildPayrollDerivedAmounts({
          baseSalary: toDecimalNumber(nextEmployee.baseSalary),
          leaveDeduction: toDecimalNumber(payroll.leaveDeduction),
          otherDeduction: toDecimalNumber(payroll.otherDeduction),
          otherDeductionNote: payroll.otherDeductionNote,
          bonus: toDecimalNumber(payroll.bonus),
          socialInsurance:
            payroll.socialInsurance !== null
              ? toDecimalNumber(payroll.socialInsurance)
              : undefined,
          housingFund:
            payroll.housingFund !== null
              ? toDecimalNumber(payroll.housingFund)
              : undefined,
        });

        await transaction.employeePayroll.update({
          where: { id: payroll.id },
          data: {
            baseSalary: nextEmployee.baseSalary,
            actualSalary: new Prisma.Decimal(derivedAmounts.actualSalary),
            totalLaborCost: new Prisma.Decimal(derivedAmounts.totalLaborCost),
          },
        });

        if (payroll.status !== EmployeePayrollStatus.confirmed) {
          return;
        }

        await this.costsService.syncPayrollCosts(transaction, {
          storeId: nextEmployee.storeId,
          payrollId: payroll.id,
          operatorStaffId,
          employeeName: nextEmployee.name,
          month: payroll.month,
          actualSalary: derivedAmounts.actualSalary,
          socialInsurance:
            payroll.socialInsurance !== null
              ? toDecimalNumber(payroll.socialInsurance)
              : undefined,
          housingFund:
            payroll.housingFund !== null
              ? toDecimalNumber(payroll.housingFund)
              : undefined,
          note: payroll.note,
        });
      }),
    );

    await this.syncEmployeePayrollNames(transaction, nextEmployee, nameChanged);
  }

  private async syncEmployeePayrollNames(
    transaction: Prisma.TransactionClient,
    employee: Employee,
    nameChanged: boolean,
  ): Promise<void> {
    if (!nameChanged) {
      return;
    }

    await transaction.employeePayroll.updateMany({
      where: { employeeId: employee.id },
      data: { employeeName: employee.name },
    });
  }

  private async syncPayrollCostTitles(
    transaction: Prisma.TransactionClient,
    previousEmployee: Employee,
    nextEmployee: Employee,
    nameChanged: boolean,
  ): Promise<void> {
    if (!nameChanged) {
      return;
    }

    await transaction.$executeRaw`
      UPDATE cost_records
      SET title = REPLACE(title, ${previousEmployee.name}, ${nextEmployee.name})
      WHERE payroll_id IN (
        SELECT id FROM employee_payrolls WHERE employee_id = ${nextEmployee.id}
      )
    `;
  }

  private async syncLinkedStaffIdentity(
    transaction: Prisma.TransactionClient,
    employee: Employee,
    nameChanged: boolean,
    phoneChanged: boolean,
  ): Promise<void> {
    if (
      employee.linkedStaffId === null ||
      (!nameChanged && !phoneChanged)
    ) {
      return;
    }

    const updatedStaff = await transaction.staff.update({
      where: { id: employee.linkedStaffId },
      data: {
        ...(nameChanged ? { name: employee.name } : {}),
        ...(phoneChanged ? { phone: employee.phone } : {}),
      },
      select: { userId: true },
    });

    if (!nameChanged || updatedStaff.userId === null) {
      return;
    }

    await transaction.user.update({
      where: { id: updatedStaff.userId },
      data: { name: employee.name },
    });
  }
}
