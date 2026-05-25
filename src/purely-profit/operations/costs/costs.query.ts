import { Prisma } from '@prisma/client';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCostRange, toPayrollMonth } from './costs.domain';
import type {
  CostFilterRange,
  CostQueryInput,
  CostReportCategoryFilterValue,
  CostReportCostRow,
  CostReportPreviousRow,
  CostReportPayrollRow,
} from './costs.types';

export async function buildHistoryAwareCostRecordWhere(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  query: CostQueryInput,
): Promise<Prisma.CostRecordWhereInput | null> {
  const range = await buildHistoryAwareCostRange(
    platformMembershipAccessService,
    storeId,
    query,
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
): Promise<{
  costRows: CostReportCostRow[];
  previousRows: CostReportPreviousRow[];
  payrollRows: CostReportPayrollRow[];
}> {
  const costRowsPromise: Promise<CostReportCostRow[]> =
    prisma.costRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
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
    });

  const previousRowsPromise: Promise<CostReportPreviousRow[]> = previousRange
    ? prisma.costRecord.findMany({
        where: {
          storeId,
          date: {
            gte: new Date(previousRange.start),
            lte: new Date(previousRange.end),
          },
        },
        select: {
          amount: true,
        },
      })
    : Promise.resolve([]);

  const payrollRowsPromise: Promise<CostReportPayrollRow[]> =
    categoryFilter === 'salary'
      ? prisma.employeePayroll.findMany({
          where: {
            storeId,
            status: 'draft',
            month: {
              gte: toPayrollMonth(currentRange.start),
              lte: toPayrollMonth(currentRange.end),
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
        })
      : Promise.resolve([]);

  const [costRows, previousRows, payrollRows] = await Promise.all([
    costRowsPromise,
    previousRowsPromise,
    payrollRowsPromise,
  ]);

  return {
    costRows,
    previousRows,
    payrollRows,
  };
}

async function buildHistoryAwareCostRange(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  query: CostQueryInput,
): Promise<CostFilterRange | null | undefined> {
  const range = buildCostRange(query);
  if (!range) {
    const historyWindowStart =
      await platformMembershipAccessService.getHistoryWindowStart(storeId);
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
  );
  if (clampedRange.empty) {
    return null;
  }

  return {
    gte: new Date(clampedRange.start),
    lte: new Date(clampedRange.end),
  };
}
