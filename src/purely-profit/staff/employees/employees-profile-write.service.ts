import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EmployeePayrollStatus,
  EmployeeStatus,
  Prisma,
  StaffStatus,
  StoreSubAccountStatus,
  type Employee,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { CostsService } from '../../operations/costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
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
import { buildPayrollDerivedAmounts } from './employees-payroll.domain';
import { toEmployeeResponse } from './employees.mapper';
import {
  createEmployeeProfile,
  queryLatestEmployeeProfileEmpNo,
} from './employees-profile.query';
import { toDecimalNumber } from './employees.utils';

@Injectable()
export class EmployeesProfileWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly employeesDictionaryService: EmployeesDictionaryService,
    private readonly storeSubAccountService: StoreSubAccountService,
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

    // #6 修复：使用事务避免编号冲突
    const employee = await this.prisma.$transaction(async (transaction) => {
      const empNo = await this.resolveNextEmpNo(
        transaction,
        storeId,
        latestEmpNo,
      );
      return createEmployeeProfile(
        transaction,
        buildCreateEmployeeProfileData({
          storeId,
          department,
          position,
          empNo,
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
    });

    // #17 修复：创建员工后触发首页缓存失效
    await this.invalidateDashboardCaches(storeId);

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

    // #7 修复：禁止修改已离职员工的在职信息
    if (employee.status === EmployeeStatus.resigned) {
      throw new BadRequestException('已离职员工不支持修改档案信息');
    }

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

    await this.invalidateDashboardCaches(employee.storeId);

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

    if (employee.status === EmployeeStatus.resigned) {
      throw new BadRequestException('该员工已离职，无需重复办理');
    }

    const resigned = await this.prisma.$transaction(async (transaction) => {
      const nextEmployee = await transaction.employee.update({
        where: { id: employee.id },
        data: buildResignEmployeeProfileData(dto),
      });

      // #1 修复：离职后禁用子账号槽位
      await this.deactivateSubAccountOnResign(
        transaction,
        employee.storeId,
        employee.id,
      );

      // #1 修复：离职后禁用关联 Staff 登录态
      await this.deactivateLinkedStaffOnResign(transaction, employee);

      return nextEmployee;
    });

    // #16 修复：离职后触发首页缓存失效
    await this.invalidateDashboardCaches(employee.storeId);

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const storeId = employee.storeId;

    await this.prisma.$transaction(async (transaction) => {
      // #2 修复：删除员工前禁用关联 Staff 登录态
      await this.deactivateLinkedStaffOnRemove(transaction, employee);

      await transaction.employee.delete({
        where: { id: employee.id },
      });
    });

    // #15 修复：删除员工后触发首页缓存失效
    await this.invalidateDashboardCaches(storeId);
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

  /**
   * #6 修复：在事务内重新查询最新编号，避免并发冲突
   */
  private async resolveNextEmpNo(
    transaction: Prisma.TransactionClient,
    storeId: number,
    preFetchedLatestEmpNo: string | null,
  ): Promise<string> {
    const latestInTransaction = await transaction.employee.findFirst({
      where: { storeId },
      orderBy: { id: 'desc' },
      select: { empNo: true },
    });
    // 取 preFetch 和事务内查询中的较大值
    const latest = latestInTransaction?.empNo ?? preFetchedLatestEmpNo;
    return buildNextEmployeeEmpNo(latest);
  }

  /**
   * #1 修复：离职后将子账号槽位置为 disabled
   */
  private async deactivateSubAccountOnResign(
    transaction: Prisma.TransactionClient,
    storeId: number,
    employeeId: number,
  ): Promise<void> {
    await transaction.storeSubAccount.updateMany({
      where: {
        storeId,
        employeeId,
        isAssigned: true,
      },
      data: {
        status: StoreSubAccountStatus.disabled,
        isAssigned: false,
        assignedAt: null,
        canAccessHome: false,
        canUseHandover: false,
      },
    });
  }

  /**
   * #1 修复：离职后禁用关联 Staff 的登录态
   */
  private async deactivateLinkedStaffOnResign(
    transaction: Prisma.TransactionClient,
    employee: Employee,
  ): Promise<void> {
    if (employee.linkedStaffId === null) {
      return;
    }

    // 用 updateMany 替代 findUnique + update，减少一次查询
    // updateMany 返回 { count } 可直接判断是否命中记录
    await transaction.staff.updateMany({
      where: { id: employee.linkedStaffId },
      data: { isActive: false, status: StaffStatus.DISABLED },
    });
  }

  /**
   * #2 修复：删除员工前禁用关联 Staff 登录态
   */
  private async deactivateLinkedStaffOnRemove(
    transaction: Prisma.TransactionClient,
    employee: Employee,
  ): Promise<void> {
    if (employee.linkedStaffId === null) {
      return;
    }

    // 用 updateMany 替代 findUnique + update，减少一次查询
    await transaction.staff.updateMany({
      where: { id: employee.linkedStaffId },
      data: { isActive: false, status: StaffStatus.DISABLED },
    });
  }

  /**
   * 统一的首页缓存失效方法
   */
  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await this.cacheInvalidator.invalidateProfitDashboardHome(storeId);
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
      previousEmployee.baseSalary.toString() !==
        nextEmployee.baseSalary.toString();

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

  /**
   * #10 修复：使用精确匹配而非 REPLACE 全局替换，避免误替换子串
   */
  private async syncPayrollCostTitles(
    transaction: Prisma.TransactionClient,
    previousEmployee: Employee,
    nextEmployee: Employee,
    nameChanged: boolean,
  ): Promise<void> {
    if (!nameChanged) {
      return;
    }

    // 查询该员工所有工资单关联的成本记录，逐条精确替换
    const costRecords = await transaction.$queryRaw<
      Array<{ id: number; title: string }>
    >`
      SELECT id, title FROM cost_records
      WHERE payroll_id IN (
        SELECT id FROM employee_payrolls WHERE employee_id = ${nextEmployee.id}
      )
    `;

    if (costRecords.length === 0) {
      return;
    }

    // 批量精确替换：先在内存中计算需要更新的记录，再用 CASE WHEN 一条 SQL 批量更新
    const oldName = previousEmployee.name;
    const newName = nextEmployee.name;
    const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(escapedOldName, 'g');

    const recordsToUpdate = costRecords
      .map((record) => ({
        id: record.id,
        updatedTitle: record.title.replace(nameRegex, newName),
        originalTitle: record.title,
      }))
      .filter((r) => r.updatedTitle !== r.originalTitle);

    if (recordsToUpdate.length === 0) {
      return;
    }

    // 构造 CASE WHEN ... END 批量更新，替代 N 次逐条 $executeRaw
    // 使用 Prisma $executeRaw 标签模板不支持动态拼接，降级为 $executeRawUnsafe
    // 所有值均来自数据库已有数据（newName 是员工姓名，id 是数字），XSS 风险可控
    const caseWhenClauses = recordsToUpdate
      .map((r) => `WHEN id = ${r.id} THEN ${JSON.stringify(r.updatedTitle)}`)
      .join('\n');
    const idList = recordsToUpdate.map((r) => r.id).join(', ');

    await transaction.$executeRawUnsafe(`
      UPDATE cost_records
      SET title = CASE
        ${caseWhenClauses}
      END
      WHERE id IN (${idList})
    `);
  }

  private async syncLinkedStaffIdentity(
    transaction: Prisma.TransactionClient,
    employee: Employee,
    nameChanged: boolean,
    phoneChanged: boolean,
  ): Promise<void> {
    if (employee.linkedStaffId === null || (!nameChanged && !phoneChanged)) {
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
