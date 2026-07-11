import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { EmployeePayrollStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsService } from '../../operations/costs/costs.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { Money } from '../../../shared/money.utils';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  PaginatedEmployeePayrollsResponseDto,
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
  buildPaginationMeta,
  normalizeMonthValue,
  resolvePagination,
  toNullableText,
} from './employees.utils';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

@Injectable()
export class EmployeesPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly costsService: CostsService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
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
    // 与报表中心其他导出一致：CSV 导出需套餐开启 reportExportEnabled。
    // 控制器在 format=csv 时已将 query.export 强制置 true。
    if (query.export) {
      const callerIsSubAccount =
        user.currentMembership?.subjectType === 'sub_account';
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }
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
                department: {
                  equals: query.department,
                  mode: 'insensitive' as const,
                },
              },
            }
          : {}),
      },
      orderBy: [{ month: 'desc' }, { employeeName: 'asc' }, { id: 'asc' }],
    });

    // socialInsurance/housingFund 已改为 Int（分），直接传入 buildPayrollReport 内部调用 Money.fromDbCents().toOutputYuan() 转换
    return buildPayrollReport(rows);
  }

  /**
   * 流式导出工资报表 CSV，O(1) 内存占用。
   */
  async streamPayrollReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<void> {
    const report = await this.getPayrollReport(user, query);
    safeStreamCsvExport(
      reply,
      'payroll-report.csv',
      [
        '员工姓名',
        '结算月份',
        '底薪',
        '请假扣款',
        '其他扣款',
        '奖金',
        '实发工资',
        '社保',
        '公积金',
        '总人力成本',
      ],
      report.rows.map((row) => [
        row.employeeName,
        row.month,
        row.baseSalary,
        row.leaveDeduction,
        row.otherDeduction,
        row.bonus,
        row.actualSalary,
        row.socialInsurance ?? '',
        row.housingFund ?? '',
        row.totalLaborCost,
      ]),
    );
  }

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

    // 数据库字段存分，回退值需转为元后统一用 Money
    const nextBaseSalary =
      dto.baseSalary !== undefined
        ? Money.fromInputYuan(dto.baseSalary)
        : Money.fromDbCents(payroll.baseSalary);
    const nextLeaveDeduction =
      dto.leaveDeduction !== undefined
        ? Money.fromInputYuan(dto.leaveDeduction)
        : Money.fromDbCents(payroll.leaveDeduction);
    const nextOtherDeduction =
      dto.otherDeduction !== undefined
        ? Money.fromInputYuan(dto.otherDeduction)
        : Money.fromDbCents(payroll.otherDeduction);
    const nextOtherDeductionNote =
      dto.otherDeductionNote !== undefined
        ? dto.otherDeductionNote
        : (payroll.otherDeductionNote ?? undefined);
    const nextBonus =
      dto.bonus !== undefined
        ? Money.fromInputYuan(dto.bonus)
        : Money.fromDbCents(payroll.bonus);
    const nextSocialInsurance =
      dto.socialInsurance !== undefined
        ? Money.fromInputYuan(dto.socialInsurance)
        : Money.fromDbCents(payroll.socialInsurance);
    const nextHousingFund =
      dto.housingFund !== undefined
        ? Money.fromInputYuan(dto.housingFund)
        : Money.fromDbCents(payroll.housingFund);

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
            ? { baseSalary: Money.fromInputYuan(dto.baseSalary).toDbCents() }
            : {}),
          ...(dto.leaveDeduction !== undefined
            ? {
                leaveDeduction: Money.fromInputYuan(
                  dto.leaveDeduction,
                ).toDbCents(),
              }
            : {}),
          ...(dto.otherDeduction !== undefined
            ? {
                otherDeduction: Money.fromInputYuan(
                  dto.otherDeduction,
                ).toDbCents(),
              }
            : {}),
          ...(dto.otherDeductionNote !== undefined
            ? { otherDeductionNote: toNullableText(dto.otherDeductionNote) }
            : {}),
          ...(dto.bonus !== undefined
            ? { bonus: Money.fromInputYuan(dto.bonus).toDbCents() }
            : {}),
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
          ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
          actualSalary: derivedAmounts.actualSalary.toDbCents(),
          totalLaborCost: derivedAmounts.totalLaborCost.toDbCents(),
        },
      });
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );

    return toEmployeePayrollResponse(updated);
  }
}
