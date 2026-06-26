import {
  EmployeePayrollStatus,
  EmployeeStatus,
  type Employee,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

export interface QueryEmployeesPageParams {
  where: Prisma.EmployeeWhereInput;
  orderBy: Prisma.EmployeeOrderByWithRelationInput[];
  skip: number;
  take: number;
}

export interface QueryEmployeesPageResult {
  items: Employee[];
  total: number;
}

export interface QueryEmployeesOverviewParams {
  storeId: number;
  monthStart: Date;
}

export interface EmployeeOverviewMetricRow {
  days: Prisma.Decimal;
}

export interface QueryEmployeesOverviewResult {
  activeCount: number;
  resignedCount: number;
  leaveRows: EmployeeOverviewMetricRow[];
  pendingPayrollCount: number;
  resignedThisMonth: number;
}

export async function queryEmployeesPage(
  prisma: PrismaService,
  params: QueryEmployeesPageParams,
): Promise<QueryEmployeesPageResult> {
  const [items, total] = await Promise.all([
    prisma.employee.findMany({
      where: params.where,
      orderBy: params.orderBy,
      skip: params.skip,
      take: params.take,
    }),
    prisma.employee.count({ where: params.where }),
  ]);

  return {
    items,
    total,
  };
}

export async function queryEmployeesOverviewMetrics(
  prisma: PrismaService,
  params: QueryEmployeesOverviewParams,
): Promise<QueryEmployeesOverviewResult> {
  const [
    activeCount,
    resignedCount,
    leaveRows,
    pendingPayrollCount,
    resignedThisMonth,
  ] = await Promise.all([
    prisma.employee.count({
      where: { storeId: params.storeId, status: EmployeeStatus.active },
    }),
    prisma.employee.count({
      where: { storeId: params.storeId, status: EmployeeStatus.resigned },
    }),
    prisma.employeeLeave.findMany({
      where: {
        storeId: params.storeId,
        startDate: { gte: params.monthStart },
      },
      select: { days: true },
    }),
    prisma.employeePayroll.count({
      where: {
        storeId: params.storeId,
        month: params.monthStart,
        status: EmployeePayrollStatus.draft,
      },
    }),
    prisma.employee.count({
      where: {
        storeId: params.storeId,
        status: EmployeeStatus.resigned,
        resignDate: { gte: params.monthStart },
      },
    }),
  ]);

  return {
    activeCount,
    resignedCount,
    leaveRows,
    pendingPayrollCount,
    resignedThisMonth,
  };
}
