import {
  EmployeePayrollStatus,
  EmployeeStatus,
  type Employee,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { calculateLeaveDays } from './employees-leave.domain';

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
  days: number;
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
  // 计算下月月初，用于筛选与本月有交集的请假记录
  const ms = params.monthStart;
  const nextMonthStart = new Date(
    Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );

  const [
    activeCount,
    resignedCount,
    leaveRows,
    pendingPayrollCount,
    resignedThisMonth,
  ] = await Promise.all([
    prisma.employee.count({
      where: { storeId: params.storeId, deletedAt: null, status: EmployeeStatus.active },
    }),
    prisma.employee.count({
      where: { storeId: params.storeId, deletedAt: null, status: EmployeeStatus.resigned },
    }),
    // 筛选与本月有交集的请假（含跨月），并在应用层按本月实际天数重算
    prisma.employeeLeave.findMany({
      where: {
        storeId: params.storeId,
        endDate: { gte: ms },
        startDate: { lt: nextMonthStart },
      },
      select: { days: true, startDate: true, endDate: true },
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
        deletedAt: null,
        status: EmployeeStatus.resigned,
        resignDate: { gte: params.monthStart },
      },
    }),
  ]);

  return {
    activeCount,
    resignedCount,
    leaveRows: leaveRows.map((r) => {
      // 跨月请假：按落入本月内的实际天数计算
      const effectiveStart = Math.max(
        r.startDate.getTime(),
        ms.getTime(),
      );
      const effectiveEnd = Math.min(
        r.endDate.getTime(),
        nextMonthStart.getTime(),
      );
      return { days: calculateLeaveDays(effectiveStart, effectiveEnd) };
    }),
    pendingPayrollCount,
    resignedThisMonth,
  };
}
