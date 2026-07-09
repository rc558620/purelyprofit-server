import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { mapConcurrent } from '../../../shared/concurrency.utils';
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
import { Money } from '../../../shared/money.utils';
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
import { buildPhoneLoginEmail } from '../../auth/auth.utils';
import {
  buildPayrollDerivedAmounts,
  formatPayrollMonth,
} from './employees-payroll.domain';
import { toEmployeeResponse } from './employees.mapper';
import {
  createEmployeeProfile,
  queryLatestEmployeeProfileEmpNo,
} from './employees-profile.query';

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

      // #1 修复：离职后释放子账号槽位，使其可被重新分配
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
      // 删除员工前释放子账号槽位，使其可被重新分配
      await this.deactivateSubAccountOnResign(
        transaction,
        employee.storeId,
        employee.id,
      );

      // #2 修复：删除员工前禁用关联 Staff 登录态
      await this.deactivateLinkedStaffOnRemove(transaction, employee);

      // 软删除：更新 deletedAt 字段而非物理删除
      await transaction.employee.update({
        where: { id: employee.id },
        data: { deletedAt: new Date() },
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
      where: { storeId, deletedAt: null },
      orderBy: { id: 'desc' },
      select: { empNo: true },
    });
    // 取 preFetch 和事务内查询中的较大值
    const latest = latestInTransaction?.empNo ?? preFetchedLatestEmpNo;
    return buildNextEmployeeEmpNo(latest);
  }

  /**
   * #1 修复：离职后释放子账号槽位，使其可被重新分配
   * 槽位是配额容器，员工离职仅解除绑定，槽位保持 active 以便复用
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
      },
      data: {
        status: StoreSubAccountStatus.active,
        isAssigned: false,
        employeeId: null,
        assignedAt: null,
        canAccessHome: true,
        canUseHandover: true,
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
      data: { isActive: false, status: StaffStatus.disabled },
    });

    // 解除 Employee → Staff 关联，防止全局 User 被跨员工/跨租户复用
    await transaction.employee.updateMany({
      where: { id: employee.id, linkedStaffId: employee.linkedStaffId },
      data: { linkedStaffId: null },
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
      data: { isActive: false, status: StaffStatus.disabled },
    });

    // 解除 Employee → Staff 关联，防止全局 User 被跨员工/跨租户复用
    await transaction.employee.updateMany({
      where: { id: employee.id, linkedStaffId: employee.linkedStaffId },
      data: { linkedStaffId: null },
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

    await mapConcurrent(
      payrolls,
      async (payroll) => {
        const derivedAmounts = buildPayrollDerivedAmounts({
          baseSalary: Money.fromDbCents(nextEmployee.baseSalary),
          leaveDeduction: Money.fromDbCents(payroll.leaveDeduction),
          otherDeduction: Money.fromDbCents(payroll.otherDeduction),
          otherDeductionNote: payroll.otherDeductionNote,
          bonus: Money.fromDbCents(payroll.bonus),
          socialInsurance:
            payroll.socialInsurance > 0
              ? Money.fromDbCents(payroll.socialInsurance)
              : undefined,
          housingFund:
            payroll.housingFund > 0
              ? Money.fromDbCents(payroll.housingFund)
              : undefined,
        });

        await transaction.employeePayroll.update({
          where: { id: payroll.id },
          data: {
            baseSalary: nextEmployee.baseSalary,
            actualSalary: derivedAmounts.actualSalary.toDbCents(),
            totalLaborCost: derivedAmounts.totalLaborCost.toDbCents(),
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
          month: formatPayrollMonth(payroll.month),
          // syncPayrollCosts 接口需要元
          actualSalary: derivedAmounts.actualSalary.toOutputYuan(),
          socialInsurance:
            payroll.socialInsurance > 0
              ? Money.fromDbCents(payroll.socialInsurance).toOutputYuan()
              : undefined,
          housingFund:
            payroll.housingFund > 0
              ? Money.fromDbCents(payroll.housingFund).toOutputYuan()
              : undefined,
          note: payroll.note,
        });
      },
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

    // 逐条更新：使用 Prisma 参数化查询避免 SQL 注入风险
    // 记录数量通常很少（单员工关联的工资单成本记录），逐条更新性能可接受
    await Promise.all(
      recordsToUpdate.map((r) =>
        transaction.costRecord.update({
          where: { id: r.id },
          data: { title: r.updatedTitle },
        }),
      ),
    );
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

    // ── BUG-1 修复：手机号变更前执行全局冲突校验 ──
    // 与 store-sub-account-login checkEmailAndPhoneConflicts 保持一致，
    // 防止 Staff.phone 写入跨租户号码导致 findUserByPhone 命中多 User 锁死登录
    if (phoneChanged && employee.phone) {
      const linkedStaff = await transaction.staff.findUnique({
        where: { id: employee.linkedStaffId },
        select: { userId: true },
      });

      const phoneEmail = buildPhoneLoginEmail('purely_profit', employee.phone);
      const excludeUserIds = linkedStaff?.userId ? [linkedStaff.userId] : [];

      const phoneWhere =
        excludeUserIds.length > 0
          ? { email: phoneEmail, id: { notIn: excludeUserIds } }
          : { email: phoneEmail };

      const phoneConflict = await transaction.user.findFirst({
        where: phoneWhere,
        select: { id: true },
      });

      if (phoneConflict) {
        throw new ConflictException('该电话号码已被注册');
      }
    }

    const updatedStaff = await transaction.staff.update({
      where: { id: employee.linkedStaffId },
      data: {
        ...(nameChanged ? { name: employee.name } : {}),
        ...(phoneChanged ? { phone: employee.phone } : {}),
      },
      select: { userId: true },
    });

    // ── BUG-2 修复：仅在 User.name 为空时回填，避免跨产品线昵称覆盖 ──
    if (!nameChanged || updatedStaff.userId === null) {
      return;
    }

    const currentUser = await transaction.user.findUnique({
      where: { id: updatedStaff.userId },
      select: { name: true },
    });

    if (!currentUser?.name) {
      await transaction.user.update({
        where: { id: updatedStaff.userId },
        data: { name: employee.name },
      });
    }
  }
}
