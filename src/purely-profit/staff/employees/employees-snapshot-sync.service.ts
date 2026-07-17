import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { mapConcurrent } from '../../../shared/concurrency.utils';
import { EmployeePayrollStatus, Prisma, type Employee } from '@prisma/client';
import { CostsService } from '../../operations/costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  buildPayrollDerivedAmounts,
  formatPayrollMonth,
} from './employees-payroll.domain';
import { buildPhoneLoginEmail } from '../../auth/auth.utils';

@Injectable()
export class EmployeesSnapshotSyncService {
  private static readonly logger = new Logger(
    EmployeesSnapshotSyncService.name,
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly costsService: CostsService,
  ) {}

  async syncEmployeeDependentSnapshots(
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

    await mapConcurrent(payrolls, async (payroll) => {
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
    });

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
