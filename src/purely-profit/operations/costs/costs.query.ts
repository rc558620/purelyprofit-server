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
  _callerIsSubAccount = false,
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
  maxPageSize = 5000,
): Promise<{
  costRows: CostReportCostRow[];
  previousTotal: number;
  payrollRows: CostReportPayrollRow[];
  currentTotalCents: number;
  currentCount: number;
  fixedCents: number;
  variableCents: number;
  categoryCents: Map<CostReportCostRow['category'], number>;
}> {
  const categoryWhere =
    categoryFilter !== 'all' ? { category: categoryFilter } : {};

  const currentWhere = {
    storeId,
    date: {
      gte: new Date(currentRange.start),
      lte: new Date(currentRange.end),
    },
    ...categoryWhere,
  };

  const costRowsPromise: Promise<CostReportCostRow[]> =
    prisma.costRecord.findMany({
      where: currentWhere,
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

  const previousTotalPromise: Promise<number> = (async () => {
    if (!previousRange) {
      return 0;
    }
    const result = await prisma.costRecord.aggregate({
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
    });
    return Number(result._sum.amount ?? 0);
  })();

  // 汇总口径统一走聚合，避免大批量时 total / recordCount 被 maxPageSize 截断而失真
  const currentAggregatePromise = prisma.costRecord.aggregate({
    where: currentWhere,
    _sum: { amount: true },
    _count: { _all: true },
  });

  const typeRowsPromise = prisma.costRecord.groupBy({
    by: ['type'],
    where: currentWhere,
    _sum: { amount: true },
  });

  const categoryRowsPromise = prisma.costRecord.groupBy({
    by: ['category'],
    where: currentWhere,
    _sum: { amount: true },
  });

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

  const [
    costRows,
    previousTotal,
    currentAggregate,
    typeRows,
    categoryRows,
    payrollRows,
  ] = await Promise.all([
    costRowsPromise,
    previousTotalPromise,
    currentAggregatePromise,
    typeRowsPromise,
    categoryRowsPromise,
    payrollRowsPromise,
  ]);

  const categoryCents = new Map<CostReportCostRow['category'], number>();
  for (const row of categoryRows) {
    categoryCents.set(
      row.category,
      (categoryCents.get(row.category) ?? 0) + Number(row._sum.amount ?? 0),
    );
  }

  return {
    costRows,
    previousTotal,
    payrollRows,
    currentTotalCents: Number(currentAggregate._sum.amount ?? 0),
    currentCount: currentAggregate._count._all,
    fixedCents: Number(
      typeRows.find((record) => record.type === 'fixed')?._sum.amount ?? 0,
    ),
    variableCents: Number(
      typeRows.find((record) => record.type === 'variable')?._sum.amount ?? 0,
    ),
    categoryCents,
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
