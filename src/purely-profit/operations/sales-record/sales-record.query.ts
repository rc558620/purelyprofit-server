import { Prisma } from '@prisma/client';
import {
  getEndOfDay,
  getStartOfDay,
  toDecimalNumber,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SaleOrderWithItems } from './sales-record.domain';
import { buildOrderNo, type SalesPeriodRange } from './sales-record.utils';

export interface SalesStatsAggregation {
  totalRevenue: number;
  totalProfit: number;
  orderCount: number;
}

export type { SalesPeriodRange };

// ---------------------------------------------------------------------------
// 统计聚合
// ---------------------------------------------------------------------------

export async function aggregateOrderStats(
  prisma: PrismaService,
  storeId: number,
  range: SalesPeriodRange,
): Promise<SalesStatsAggregation> {
  const aggregation = await prisma.saleOrder.aggregate({
    where: {
      storeId,
      date: {
        gte: new Date(range.start),
        lte: new Date(range.end),
      },
    },
    _count: { id: true },
    _sum: {
      totalRevenue: true,
      totalProfit: true,
    },
  });

  return {
    totalRevenue: toDecimalNumber(aggregation._sum.totalRevenue),
    totalProfit: toDecimalNumber(aggregation._sum.totalProfit),
    orderCount: aggregation._count.id,
  };
}

// ---------------------------------------------------------------------------
// 列表查询
// ---------------------------------------------------------------------------

export async function querySaleOrders(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: SalesPeriodRange;
    skip?: number;
    take?: number;
  },
): Promise<SaleOrderWithItems[]> {
  return prisma.saleOrder.findMany({
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.range.start),
        lte: new Date(params.range.end),
      },
    },
    include: {
      items: {
        orderBy: [{ id: 'asc' }],
      },
      spaceSession: {
        select: {
          space: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    skip: params.skip,
    take: params.take,
  });
}

export function countSaleOrders(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: SalesPeriodRange;
  },
): Promise<number> {
  return prisma.saleOrder.count({
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.range.start),
        lte: new Date(params.range.end),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 订单号生成
// ---------------------------------------------------------------------------

function buildSalesOrderSequenceLockKey(date: Date): number {
  return Number(
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}`,
  );
}

export async function generateOrderNo(
  client: Prisma.TransactionClient,
  storeId: number,
  date: Date,
): Promise<string> {
  const dayStart = getStartOfDay(date.getTime());
  const dayEnd = getEndOfDay(date.getTime());
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${storeId},
      ${buildSalesOrderSequenceLockKey(date)}
    )
  `;
  const count = await client.saleOrder.count({
    where: {
      storeId,
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
  });

  return buildOrderNo(date, count + 1);
}
