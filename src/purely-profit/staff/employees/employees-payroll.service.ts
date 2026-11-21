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
  buildPayrollSaveWriteData,
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
} from './employees.utils';
import { CommissionCoreService } from '../../operations/commission/commission-core.service';

/** Prisma 唯一约束冲突（同员工同月工资单唯一键） */
function isPayrollUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

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
      // 员工档案软删除后，其历史工资单不应再出现在列表中。
      // 部门过滤必须写进同一个 employee 对象：若两者各自展开出一个 employee key，
      // 后者会整体覆盖前者，软删除过滤会被静默丢弃。
      employee: {
        deletedAt: null,
        ...(query.department
          ? {
              department: {
                equals: query.department,
                mode: 'insensitive' as const,
              },
            }
          : {}),
      },
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(targetMonth ? { month: targetMonth } : {}),
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
    const payroll = await this.prisma.$transaction(async (transaction) => {
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

      const draftData = buildPayrollSaveWriteData({
        dto,
        employeeName: employee.name,
        existing,
      });

      if (!existing) {
        try {
          return await transaction.employeePayroll.create({
            data: {
              storeId: employee.storeId,
              employeeId: employee.id,
              month,
              ...draftData,
            },
          });
        } catch (error: unknown) {
          // 同员工同月存在唯一约束：并发首存时后到的一方转成可读的业务冲突
          if (isPayrollUniqueViolation(error)) {
            throw new ConflictException(
              '该月份工资正在被其他操作保存，请刷新后重试',
            );
          }
          throw error;
        }
      }

      // 条件更新：读取后被并发确认时，本次草稿写入必须失败而不是覆盖已结算工资
      const { count } = await transaction.employeePayroll.updateMany({
        where: { id: existing.id, status: EmployeePayrollStatus.draft },
        data: draftData,
      });
      if (count === 0) {
        throw new ConflictException('该月份工资已确认结算，不能覆盖保存');
      }

      return transaction.employeePayroll.findUniqueOrThrow({
        where: { id: existing.id },
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
      // 条件更新：并发确认只允许一次成功，否则成本记录会被重复同步
      const { count } = await transaction.employeePayroll.updateMany({
        where: { id: payroll.id, status: EmployeePayrollStatus.draft },
        data: {
          status: EmployeePayrollStatus.confirmed,
          confirmedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException('该工资记录已确认，无需重复确认');
      }

      const nextPayroll = await transaction.employeePayroll.findUniqueOrThrow({
        where: { id: payroll.id },
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
      // 计入工资：只标记真正被工资单提成金额覆盖的已结账提成（幂等）。
      // 传 commission 作为金额上限，避免工资单只计入部分金额却把当月提成全部核销。
      await this.commissionCoreService.markSettledRecordsIncluded(
        transaction,
        nextPayroll.storeId,
        nextPayroll.employeeId,
        formatPayrollMonth(nextPayroll.month),
        nextPayroll.commission,
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

    // 条件删除 + 版本校验：读取后被并发确认或改写的记录不能被删除
    const { count } = await this.prisma.employeePayroll.deleteMany({
      where: { id: payroll.id, status: EmployeePayrollStatus.draft },
    });
    if (count === 0) {
      throw new ConflictException('工资记录已被其他操作更新，请刷新后重试');
    }

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

    const updated = await this.prisma.$transaction(async (transaction) => {
      // 事务内重读：状态与金额基线都必须来自最新已提交数据
      const current = await transaction.employeePayroll.findUnique({
        where: { id: payrollId },
      });
      if (!current) {
        throw new NotFoundException('工资记录不存在');
      }
      if (current.status === EmployeePayrollStatus.confirmed) {
        throw new ConflictException('已确认结算的工资记录不能编辑');
      }

      // 合并 DTO 与当前金额，计算派生值
      const merged = resolvePayrollMergedAmounts(dto, current);
      const derivedAmounts = buildPayrollDerivedAmounts(merged);

      // 条件更新 + updatedAt 乐观锁：读取后被确认或被他人改写时本次写入失败，
      // 不再出现「结算已按旧金额同步成本，随后草稿写入把金额改掉」。
      const { count } = await transaction.employeePayroll.updateMany({
        where: {
          id: payrollId,
          status: EmployeePayrollStatus.draft,
          updatedAt: current.updatedAt,
        },
        data: buildPayrollUpdateData(dto, derivedAmounts),
      });
      if (count === 0) {
        throw new ConflictException('工资记录已被其他操作更新，请刷新后重试');
      }

      return transaction.employeePayroll.findUniqueOrThrow({
        where: { id: payrollId },
      });
    });

    // 首页动态依赖工资单数据（工资单待确认）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      payroll.storeId,
    );

    return toEmployeePayrollResponse(updated);
  }
}
