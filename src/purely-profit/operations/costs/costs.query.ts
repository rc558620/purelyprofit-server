import type { Prisma } from '@prisma/client';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCostRange,
  getPayrollCostDate,
  toPayrollMonth,
} from './costs.domain';
import type {
  CostFilterRange,
  CostQueryInput,
  CostReportCategoryFilterValue,
  CostReportCostRow,
  CostReportPayrollRow,
} from './costs.types';

export async function buildHistoryAwareCostRecordWhere(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  query: CostQueryInput,
  callerIsSubAccount = false,
): Promise<Prisma.CostRecordWhereInput | null> {
  const range = await buildHistoryAwareCostRange(
    platformMembershipAccessService,
    storeId,
    query,
    callerIsSubAccount,
  );

  if (range === null) {
    return null;
  }

  return {
    storeId,
    ...(range ? { date: range } : {}),
    ...(query.typeFilter && query.typeFilter !== 'all'
      ? { type: query.typeFilter }
      : {}),
  };
}

export async function queryCostReportRows(
  prisma: PrismaService,
  storeId: number,
  currentRange: { start: number; end: number },
  previousRange: { start: number; end: number } | null,
  categoryFilter: CostReportCategoryFilterValue,
  maxPageSize = 5000,
): Promise<{
  costRows: CostReportCostRow[];
  previousTotal: number;
  payrollRows: CostReportPayrollRow[];
}> {
  const categoryWhere =
    categoryFilter !== 'all' ? { category: categoryFilter } : {};

  const costRowsPromise: Promise<CostReportCostRow[]> =
    prisma.costRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
        ...categoryWhere,
      },
      select: {
        id: true,
        title: true,
        type: true,
        category: true,
        amount: true,
        note: true,
        date: true,
        createdAt: true,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: maxPageSize,
    });

  const previousTotalPromise: Promise<number> = previousRange
    ? prisma.costRecord
        .aggregate({
          where: {
            storeId,
            date: {
              gte: new Date(previousRange.start),
              lte: new Date(previousRange.end),
            },
            ...categoryWhere,
          },
          _sum: {
            amount: true,
          },
        })
        .then((result) => result._sum.amount ?? 0)
    : Promise.resolve(0);

  const payrollRowsPromise: Promise<CostReportPayrollRow[]> =
    categoryFilter === 'salary'
      ? prisma.employeePayroll.findMany({
          where: {
            storeId,
            status: 'draft',
            month: {
              gte: getPayrollCostDate(toPayrollMonth(currentRange.start)),
              lte: getPayrollCostDate(toPayrollMonth(currentRange.end)),
            },
          },
          select: {
            id: true,
            employeeName: true,
            month: true,
            actualSalary: true,
            note: true,
          },
          orderBy: [{ month: 'desc' }, { id: 'desc' }],
          take: maxPageSize,
        })
      : Promise.resolve([]);

  const [costRows, previousTotal, payrollRows] = await Promise.all([
    costRowsPromise,
    previousTotalPromise,
    payrollRowsPromise,
  ]);

  return {
    costRows,
    previousTotal,
    payrollRows,
  };
}

async function buildHistoryAwareCostRange(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  query: CostQueryInput,
  callerIsSubAccount = false,
): Promise<CostFilterRange | null | undefined> {
  const range = buildCostRange(query);
  if (!range) {
    const historyWindowStart =
      await platformMembershipAccessService.getHistoryWindowStart(
        storeId,
        callerIsSubAccount,
      );
    if (historyWindowStart === null) {
      return undefined;
    }

    return {
      gte: new Date(historyWindowStart),
      lte: new Date(),
    };
  }

  const clampedRange = await platformMembershipAccessService.clampHistoryRange(
    storeId,
    {
      start: range.gte.getTime(),
      end: range.lte.getTime(),
    },
    callerIsSubAccount,
  );
  if (clampedRange.empty) {
    return null;
  }

  return {
    gte: new Date(clampedRange.start),
    lte: new Date(clampedRange.end),
  };
}
