import { EmployeeStatus, type Prisma } from '@prisma/client';
import { toDecimalNumber } from './employees.utils';

type DecimalLike = {
  toString(): string;
};

export interface EmployeeListQueryInput {
  status?: EmployeeStatus;
  department?: string;
  keyword?: string;
}

export interface EmployeeOverviewMetricsInput {
  activeCount: number;
  resignedCount: number;
  leaveRows: Array<{ days: DecimalLike }>;
  pendingPayrollCount: number;
  resignedThisMonth: number;
}

export interface EmployeesOverviewSummary {
  activeCount: number;
  resignedCount: number;
  leaveDaysThisMonth: number;
  pendingPayrollCount: number;
  resignedThisMonth: number;
}

export function buildEmployeeListWhere(
  storeId: number,
  query: EmployeeListQueryInput,
): Prisma.EmployeeWhereInput {
  return {
    storeId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.department
      ? { department: { equals: query.department, mode: 'insensitive' } }
      : {}),
    ...(query.keyword
      ? {
          OR: [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { empNo: { contains: query.keyword, mode: 'insensitive' } },
            { phone: { contains: query.keyword } },
            { position: { contains: query.keyword, mode: 'insensitive' } },
            { department: { contains: query.keyword, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export function buildEmployeeListOrderBy(
  status?: EmployeeStatus,
): Prisma.EmployeeOrderByWithRelationInput[] {
  return status
    ? [{ createdAt: 'desc' }, { id: 'desc' }]
    : [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }];
}

export function buildEmployeesOverviewResponse(
  metrics: EmployeeOverviewMetricsInput,
): EmployeesOverviewSummary {
  return {
    activeCount: metrics.activeCount,
    resignedCount: metrics.resignedCount,
    leaveDaysThisMonth: metrics.leaveRows.reduce(
      (sum, item) => sum + toDecimalNumber(item.days),
      0,
    ),
    pendingPayrollCount: metrics.pendingPayrollCount,
    resignedThisMonth: metrics.resignedThisMonth,
  };
}
