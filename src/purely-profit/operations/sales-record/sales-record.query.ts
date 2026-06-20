import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';
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
  // 从 sale_order_items 聚合，排除预付抵扣行，只算实际消费
  const result = await prisma.$queryRaw<
    [
      {
        revenue: Prisma.Decimal | null;
        profit: Prisma.Decimal | null;
        order_count: bigint;
      },
    ]
  >`
    SELECT
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
      COALESCE(SUM(soi.profit * soi.quantity), 0) AS profit,
      COUNT(DISTINCT so.id) AS order_count
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${storeId}
      AND so.date >= ${new Date(range.start)}
      AND so.date <= ${new Date(range.end)}
      AND soi.product_name NOT IN ('预付抵扣', '续费抵扣')
  `;

  return {
    totalRevenue: new Decimal(Number(result[0]?.revenue ?? 0))
      .toDecimalPlaces(2)
      .toNumber(),
    totalProfit: new Decimal(Number(result[0]?.profit ?? 0))
      .toDecimalPlaces(2)
      .toNumber(),
    orderCount: Number(result[0]?.order_count ?? 0),
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
  // pg_advisory_xact_lock 在事务提交/回滚后自动释放，确保同日同店订单号串行生成。
  // 注意：若外层事务持续时间很长（如空间结账），其他并发创建请求会被阻塞直到事务结束。
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
