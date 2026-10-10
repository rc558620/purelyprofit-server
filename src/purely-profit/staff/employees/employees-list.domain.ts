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
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.department
      ? { department: { equals: query.department, mode: 'insensitive' } }
      : {}),
    ...(query.keyword
      ? {
          OR: [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { empNo: { contains: query.keyword, mode: 'insensitive' } },
            { phone: { startsWith: query.keyword } },
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
  // 「离职」视图前端按 resignDate 倒序展示（见 employeeListUtils.filterAndSort），
  // 服务端分页必须同序，否则跨页会出现下一页日期反而更晚的乱序。
  // resignDate 可为 null，追加 id 兜底保证分页游标稳定。
  if (status === EmployeeStatus.resigned) {
    return [{ resignDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
  }

  // 「全部」视图前端是 active 优先再按 createdAt 倒序，对应 status 升序
  // （'active' < 'resigned'）后 createdAt 倒序。
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
