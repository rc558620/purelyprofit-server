import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeePayrollStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsService } from '../../operations/costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { Money } from '../../../shared/money.utils';
import {
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  PaginatedEmployeePayrollsResponseDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import {
  assertPayrollMonthFormat,
  buildPayrollDerivedAmounts,
  buildPayrollUpdateData,
  formatPayrollMonth,
  resolvePayrollMergedAmounts,
  resolvePayrollMonthFilter,
} from './employees-payroll.domain';
import { EmployeesAccessService } from './employees-access.service';
import { toEmployeePayrollResponse } from './employees.mapper';
import {
  buildPaginationMeta,
  normalizeMonthValue,
  resolvePagination,
  toNullableText,
} from './employees.utils';
import { CommissionCoreService } from '../../operations/commission/commission-core.service';

@Injectable()
export class EmployeesPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly costsService: CostsService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commissionCoreService: CommissionCoreService,
  ) {}

  async listPayrolls(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<PaginatedEmployeePayrollsResponseDto> {
    const manageableStoreId = this.employeesAccessService.getManageableStoreId(
      user,
      'finance:view',
    );

    const { page, skip, take } = resolvePagination(
      query.page,
      query.pageSize,
      50,
      200,
    );

    if (manageableStoreId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, page, take),
      };
    }

    if (query.storeId !== undefined && manageableStoreId !== query.storeId) {
      return {
        items: [],
        meta: buildPaginationMeta(0, page, take),
      };
    }

    const storeId = query.storeId ?? manageableStoreId;
    const targetMonth = resolvePayrollMonthFilter(query.year, query.month);
    const where: Prisma.EmployeePayrollWhereInput = {
      storeId,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(targetMonth ? { month: targetMonth } : {}),
      ...(query.department
        ? {
            employee: {
              department: {
                equals: query.department,
                mode: 'insensitive' as const,
              },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.employeePayroll.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.employeePayroll.count({ where }),
    ]);
    return {
      items: rows.map(toEmployeePayrollResponse),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async savePayroll(
    user: AuthenticatedUser,
    dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        dto.employeeId,
        'finance:manage',
      );
    // 先对字符串 trim 并校验 YYYY-MM 格式，再转为 Date（DateTime 类型，与 month 字段匹配）
    const rawMonth = dto.month.trim();
    assertPayrollMonthFormat(rawMonth);
    const month = normalizeMonthValue(rawMonth);
    const derivedAmounts = buildPayrollDerivedAmounts({
      baseSalary: Money.fromInputYuan(dto.baseSalary),
      leaveDeduction: Money.fromInputYuan(dto.leaveDeduction),
      otherDeduction: Money.fromInputYuan(dto.otherDeduction),
      otherDeductionNote: dto.otherDeductionNote,
      bonus: Money.fromInputYuan(dto.bonus),
      commission:
        dto.commission !== undefined
          ? Money.fromInputYuan(dto.commission)
          : Money.zero(),
      socialInsurance:
        dto.socialInsurance !== undefined
          ? Money.fromInputYuan(dto.socialInsurance)
          : undefined,
      housingFund:
        dto.housingFund !== undefined
          ? Money.fromInputYuan(dto.housingFund)
          : undefined,
    });

    const payroll = await this.prisma.$transaction(async (transaction) => {
      // 先查询是否已存在，避免 upsert 静默回退已确认工资单
      const existing = await transaction.employeePayroll.findUnique({
        where: {
          employeeId_month: {
            employeeId: employee.id,
            month,
          },
        },
      });

      if (existing?.status === EmployeePayrollStatus.confirmed) {
        throw new ConflictException('该月份工资已确认结算，不能覆盖保存');
      }

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
          baseSalary: Money.fromInputYuan(dto.baseSalary).toDbCents(),
          leaveDeduction: Money.fromInputYuan(dto.leaveDeduction).toDbCents(),
          otherDeduction: Money.fromInputYuan(dto.otherDeduction).toDbCents(),
          otherDeductionNote: toNullableText(dto.otherDeductionNote),
          bonus: Money.fromInputYuan(dto.bonus).toDbCents(),
          commission:
            dto.commission !== undefined
              ? Money.fromInputYuan(dto.commission).toDbCents()
              : 0,
          actualSalary: derivedAmounts.actualSalary.toDbCents(),
          socialInsurance:
            dto.socialInsurance !== undefined
              ? Money.fromInputYuan(dto.socialInsurance).toDbCents()
              : undefined,
          housingFund:
            dto.housingFund !== undefined
              ? Money.fromInputYuan(dto.housingFund).toDbCents()
              : undefined,
          totalLaborCost: derivedAmounts.totalLaborCost.toDbCents(),
          status: EmployeePayrollStatus.draft,
          note: toNullableText(dto.note),
        },
        update: {
          employeeName: employee.name,
          baseSalary: Money.fromInputYuan(dto.baseSalary).toDbCents(),
          leaveDeduction: Money.fromInputYuan(dto.leaveDeduction).toDbCents(),
          otherDeduction: Money.fromInputYuan(dto.otherDeduction).toDbCents(),
          otherDeductionNote: toNullableText(dto.otherDeductionNote),
          bonus: Money.fromInputYuan(dto.bonus).toDbCents(),
          commission:
            dto.commission !== undefined
              ? Money.fromInputYuan(dto.commission).toDbCents()
              : 0,
          actualSalary: derivedAmounts.actualSalary.toDbCents(),
          ...(dto.socialInsurance !== undefined
            ? {
                socialInsurance:
                  dto.socialInsurance > 0
                    ? Money.fromInputYuan(dto.socialInsurance).toDbCents()
                    : 0,
              }
            : {}),
          ...(dto.housingFund !== undefined
            ? {
                housingFund:
                  dto.housingFund > 0
                    ? Money.fromInputYuan(dto.housingFund).toDbCents()
                    : 0,
              }
            : {}),
          totalLaborCost: derivedAmounts.totalLaborCost.toDbCents(),
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
      'finance:manage',
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
        // 数据库存分，syncPayrollCosts 接口需要元
        actualSalary: Money.fromDbCents(
          nextPayroll.actualSalary,
        ).toOutputYuan(),
        socialInsurance:
          nextPayroll.socialInsurance > 0
            ? Money.fromDbCents(nextPayroll.socialInsurance).toOutputYuan()
            : undefined,
        housingFund:
          nextPayroll.housingFund > 0
            ? Money.fromDbCents(nextPayroll.housingFund).toOutputYuan()
            : undefined,
        note: nextPayroll.note,
      });
      // 计入工资：将员工当月已结账提成标记为「已计入工资」（幂等）
      await this.commissionCoreService.markSettledRecordsIncluded(
        transaction,
        nextPayroll.storeId,
        nextPayroll.employeeId,
        formatPayrollMonth(nextPayroll.month),
      );
      return nextPayroll;
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );
    // 确认工资单会同步沉淀薪资/社保/公积金成本记录，失效成本缓存
    await this.costsService.invalidateCostCaches(payroll.storeId);

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
      'finance:manage',
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
      'finance:manage',
    );
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('已确认结算的工资记录不能编辑');
    }

    // 合并 DTO 与现有金额，计算派生值
    const merged = resolvePayrollMergedAmounts(dto, payroll);
    const derivedAmounts = buildPayrollDerivedAmounts(merged);

    const updated = await this.prisma.$transaction(async (transaction) => {
      return transaction.employeePayroll.update({
        where: { id: payroll.id },
        data: buildPayrollUpdateData(dto, derivedAmounts),
      });
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );

    return toEmployeePayrollResponse(updated);
  }
}
