import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { EmployeePayrollStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EmployeePayrollReportResponseDto,
  ListEmployeePayrollsQueryDto,
} from './dto/employee-payroll.dto';
import { buildPayrollReport } from './employees-payroll.domain';
import { EmployeesAccessService } from './employees-access.service';
import { buildDateRange } from './employees.utils';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

@Injectable()
export class EmployeesPayrollReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
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
        // \t 前缀强制 Excel/WPS 按文本处理，避免月份/金额类型因列宽不足显示 ####
        `\t${row.month}`,
        `\t${row.baseSalary}`,
        `\t${row.leaveDeduction}`,
        `\t${row.otherDeduction}`,
        `\t${row.bonus}`,
        `\t${row.actualSalary}`,
        row.socialInsurance ? `\t${row.socialInsurance}` : '',
        row.housingFund ? `\t${row.housingFund}` : '',
        `\t${row.totalLaborCost}`,
      ]),
    );
  }
}
