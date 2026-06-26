import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeePayrollStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsService } from '../../operations/costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import {
  assertPayrollMonthFormat,
  buildPayrollDerivedAmounts,
  buildPayrollReport,
  formatPayrollMonth,
  resolvePayrollMonthFilter,
} from './employees-payroll.domain';
import { EmployeesAccessService } from './employees-access.service';
import { toEmployeePayrollResponse } from './employees.mapper';
import {
  buildDateRange,
  normalizeMonthValue,
  toNullableText,
} from './employees.utils';

@Injectable()
export class EmployeesPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly costsService: CostsService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async getPayrollReport(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollReportResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店工资报表',
      'report:view',
    );
    const dateRange = buildDateRange(query.year, query.month);
    const rows = await this.prisma.employeePayroll.findMany({
      where: {
        storeId,
        status: EmployeePayrollStatus.confirmed,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(dateRange
          ? {
              month: {
                gte: dateRange.gte,
                lt: dateRange.lt,
              },
            }
          : {}),
        ...(query.department
          ? {
              employee: {
                department: { equals: query.department, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ month: 'desc' }, { employeeName: 'asc' }, { id: 'asc' }],
    });

    // socialInsurance/housingFund 已改为 Int（分），直接传入 buildPayrollReport 内部调用 centsToYuan 转换
    return buildPayrollReport(rows);
  }

  async listPayrolls(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollResponseDto[]> {
    const manageableStoreId = this.employeesAccessService.getManageableStoreId(
      user,
      'finance:view',
    );

    if (manageableStoreId === null) {
      return [];
    }

    if (query.storeId !== undefined && manageableStoreId !== query.storeId) {
      return [];
    }

    const storeId = query.storeId ?? manageableStoreId;
    const targetMonth = resolvePayrollMonthFilter(query.year, query.month);
    const rows = await this.prisma.employeePayroll.findMany({
      where: {
        storeId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(targetMonth ? { month: targetMonth } : {}),
        ...(query.department
          ? {
              employee: {
                department: { equals: query.department, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEmployeePayrollResponse);
  }

  async savePayroll(
    user: AuthenticatedUser,
    dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        dto.employeeId,
        'finance:view',
      );
    // 先对字符串 trim 并校验 YYYY-MM 格式，再转为 Date（DateTime 类型，与 month 字段匹配）
    const rawMonth = dto.month.trim();
    assertPayrollMonthFormat(rawMonth);
    const month = normalizeMonthValue(rawMonth);
    const derivedAmounts = buildPayrollDerivedAmounts({
      baseSalary: dto.baseSalary,
      leaveDeduction: dto.leaveDeduction,
      otherDeduction: dto.otherDeduction,
      otherDeductionNote: dto.otherDeductionNote,
      bonus: dto.bonus,
      socialInsurance: dto.socialInsurance,
      housingFund: dto.housingFund,
    });

    const payroll = await this.prisma.$transaction(async (transaction) => {
      return transaction.employeePayroll.upsert({
        where: {
          employeeId_month: {
            employeeId: employee.id,
            month,
          },
        },
        create: {
          storeId: employee.storeId,
          employeeId: employee.id,
          employeeName: employee.name,
          month,
          baseSalary: this.toDecimal(dto.baseSalary),
          leaveDeduction: this.toDecimal(dto.leaveDeduction),
          otherDeduction: this.toDecimal(dto.otherDeduction),
          otherDeductionNote: toNullableText(dto.otherDeductionNote),
          bonus: this.toDecimal(dto.bonus),
          actualSalary: this.toDecimal(derivedAmounts.actualSalary),
          socialInsurance:
            dto.socialInsurance !== undefined
              ? this.toDecimal(dto.socialInsurance)
              : undefined,
          housingFund:
            dto.housingFund !== undefined
              ? this.toDecimal(dto.housingFund)
              : undefined,
          totalLaborCost: this.toDecimal(derivedAmounts.totalLaborCost),
          status: EmployeePayrollStatus.draft,
          note: toNullableText(dto.note),
        },
        update: {
          employeeName: employee.name,
          baseSalary: this.toDecimal(dto.baseSalary),
          leaveDeduction: this.toDecimal(dto.leaveDeduction),
          otherDeduction: this.toDecimal(dto.otherDeduction),
          otherDeductionNote: toNullableText(dto.otherDeductionNote),
          bonus: this.toDecimal(dto.bonus),
          actualSalary: this.toDecimal(derivedAmounts.actualSalary),
          socialInsurance:
            dto.socialInsurance !== undefined
              ? this.toDecimal(dto.socialInsurance)
              : 0,
          housingFund:
            dto.housingFund !== undefined
              ? this.toDecimal(dto.housingFund)
              : 0,
          totalLaborCost: this.toDecimal(derivedAmounts.totalLaborCost),
          status: EmployeePayrollStatus.draft,
          confirmedAt: null,
          note: toNullableText(dto.note),
        },
      });
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      employee.storeId,
    );

    return toEmployeePayrollResponse(payroll);
  }

  async confirmPayroll(
    user: AuthenticatedUser,
    payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    const payroll = await this.prisma.employeePayroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) {
      throw new NotFoundException('工资记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      payroll.storeId,
      'finance:view',
    );
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('该工资记录已确认，无需重复确认');
    }
    const confirmed = await this.prisma.$transaction(async (transaction) => {
      const nextPayroll = await transaction.employeePayroll.update({
        where: { id: payroll.id },
        data: {
          status: EmployeePayrollStatus.confirmed,
          confirmedAt: new Date(),
        },
      });
      await this.costsService.syncPayrollCosts(transaction, {
        storeId: nextPayroll.storeId,
        payrollId: nextPayroll.id,
        operatorStaffId: user.currentMembership?.staffId ?? null,
        employeeName: nextPayroll.employeeName,
        month: formatPayrollMonth(nextPayroll.month),
        // actualSalary/socialInsurance/housingFund 已改为 Int（分），需转换为元传给 syncPayrollCosts
        actualSalary: centsToYuan(nextPayroll.actualSalary),
        socialInsurance:
          nextPayroll.socialInsurance > 0
            ? centsToYuan(nextPayroll.socialInsurance)
            : undefined,
        housingFund:
          nextPayroll.housingFund > 0
            ? centsToYuan(nextPayroll.housingFund)
            : undefined,
        note: nextPayroll.note,
      });
      return nextPayroll;
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );

    return toEmployeePayrollResponse(confirmed);
  }

  async removePayroll(
    user: AuthenticatedUser,
    payrollId: number,
  ): Promise<void> {
    const payroll = await this.prisma.employeePayroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) {
      throw new NotFoundException('工资记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      payroll.storeId,
      'finance:view',
    );
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('已确认结算的工资记录不支持删除');
    }
    await this.prisma.employeePayroll.delete({ where: { id: payroll.id } });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );
  }

  async updatePayroll(
    user: AuthenticatedUser,
    payrollId: number,
    dto: UpdateEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    const payroll = await this.prisma.employeePayroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) {
      throw new NotFoundException('工资记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      payroll.storeId,
      'finance:view',
    );
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('已确认结算的工资记录不能编辑');
    }

    // 数据库字段已改为 Int（分），回退值需用 centsToYuan 转为元
    const nextBaseSalary =
      dto.baseSalary !== undefined
        ? dto.baseSalary
        : centsToYuan(payroll.baseSalary);
    const nextLeaveDeduction =
      dto.leaveDeduction !== undefined
        ? dto.leaveDeduction
        : centsToYuan(payroll.leaveDeduction);
    const nextOtherDeduction =
      dto.otherDeduction !== undefined
        ? dto.otherDeduction
        : centsToYuan(payroll.otherDeduction);
    const nextOtherDeductionNote =
      dto.otherDeductionNote !== undefined
        ? dto.otherDeductionNote
        : (payroll.otherDeductionNote ?? undefined);
    const nextBonus =
      dto.bonus !== undefined ? dto.bonus : centsToYuan(payroll.bonus);
    const nextSocialInsurance =
      dto.socialInsurance !== undefined
        ? dto.socialInsurance
        : centsToYuan(payroll.socialInsurance);
    const nextHousingFund =
      dto.housingFund !== undefined
        ? dto.housingFund
        : centsToYuan(payroll.housingFund);

    const derivedAmounts = buildPayrollDerivedAmounts({
      baseSalary: nextBaseSalary,
      leaveDeduction: nextLeaveDeduction,
      otherDeduction: nextOtherDeduction,
      otherDeductionNote: nextOtherDeductionNote,
      bonus: nextBonus,
      socialInsurance: nextSocialInsurance,
      housingFund: nextHousingFund,
    });

    const updated = await this.prisma.$transaction(async (transaction) => {
      return transaction.employeePayroll.update({
        where: { id: payroll.id },
        data: {
          ...(dto.baseSalary !== undefined
            ? { baseSalary: this.toDecimal(dto.baseSalary) }
            : {}),
          ...(dto.leaveDeduction !== undefined
            ? { leaveDeduction: this.toDecimal(dto.leaveDeduction) }
            : {}),
          ...(dto.otherDeduction !== undefined
            ? { otherDeduction: this.toDecimal(dto.otherDeduction) }
            : {}),
          ...(dto.otherDeductionNote !== undefined
            ? { otherDeductionNote: toNullableText(dto.otherDeductionNote) }
            : {}),
          ...(dto.bonus !== undefined
            ? { bonus: this.toDecimal(dto.bonus) }
            : {}),
          ...(dto.socialInsurance !== undefined
            ? {
                socialInsurance:
                  dto.socialInsurance > 0
                    ? this.toDecimal(dto.socialInsurance)
                    : 0,
              }
            : {}),
          ...(dto.housingFund !== undefined
            ? {
                housingFund:
                  dto.housingFund > 0 ? this.toDecimal(dto.housingFund) : 0,
              }
            : {}),
          ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
          actualSalary: this.toDecimal(derivedAmounts.actualSalary),
          totalLaborCost: this.toDecimal(derivedAmounts.totalLaborCost),
        },
      });
    });

    return toEmployeePayrollResponse(updated);
  }

  private toDecimal(value: number): number {
    return Math.round(value * 100);
  }
}

/**
 * 将分转换为元
 */
function centsToYuan(cents: number): number {
  return Math.round(cents) / 100;
}
