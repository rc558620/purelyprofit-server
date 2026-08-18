import { Prisma } from '@prisma/client';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiDate } from '../../../shared/shanghai-time.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  SaleOrderWithItems,
  ScanOrderingDetailSource,
} from './sales-record.domain';
import {
  buildOrderNo,
  type SalesOrderNoVariant,
  type SalesPeriodRange,
} from './sales-record.utils';

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
  // 从 sale_order_items 聚合，排除预付款行，只算实际消费
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
      COALESCE(SUM(soi.sale_price * soi.quantity), 0)
        - COALESCE(SUM(DISTINCT sor.amount), 0) AS revenue,
      COALESCE(SUM(soi.profit * soi.quantity), 0)
        - COALESCE(SUM(DISTINCT sor.profit), 0) AS profit,
      COUNT(DISTINCT so.id) FILTER (WHERE sor.id IS NULL) AS order_count
    FROM sale_orders so
    LEFT JOIN sale_order_items soi ON soi.order_id = so.id
    LEFT JOIN sale_order_refunds sor ON sor.sale_order_id = so.id
    WHERE so.store_id = ${storeId}
      AND so.date >= ${new Date(range.start)}
      AND so.date <= ${new Date(range.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
  `;

  return {
    totalRevenue: Money.fromDbCents(
      Number(result[0]?.revenue ?? 0),
    ).toOutputYuan(),
    totalProfit: Money.fromDbCents(
      Number(result[0]?.profit ?? 0),
    ).toOutputYuan(),
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
    select: {
      id: true,
      orderNo: true,
      note: true,
      paymentMethod: true,
      calcMode: true,
      operatorNameSnapshot: true,
      date: true,
      createdAt: true,
      scanOrderId: true,
      // ─── 手工补录（录入订单）元数据 ───────────────────────
      manualEntry: true,
      diningMode: true,
      sourceChannel: true,
      guestCount: true,
      externalOrderNo: true,
      customerPhone: true,
      refund: { select: { refundedAt: true } },
      // ─── 团购 / 券 / 平台结算元数据 ───────────────────────────
      customerPaymentMethod: true,
      grouponCode: true,
      grouponPlatform: true,
      settlementChannel: true,
      voucherCode: true,
      voucherPlatform: true,
      voucherFaceAmount: true,
      grouponSettlementStatus: true,
      grouponPlatformReceivable: true,
      grouponPlatformSettledAmount: true,
      grouponPlatformFee: true,
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          categoryName: true,
          salePrice: true,
          profit: true,
          quantity: true,
        },
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
      operatorStaff: {
        select: {
          role: true,
          employeeProfile: {
            select: {
              subAccounts: {
                select: { role: true },
              },
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

// ---------------------------------------------------------------------------
// 扫码点餐订单详情查询（销售记录增强数据源）
// ---------------------------------------------------------------------------

/** 批量查询销售记录关联的扫码点餐订单：营销快照（优惠清单）+ 商品规格快照。 */
export async function queryScanOrderingDetails(
  prisma: PrismaService,
  scanOrderIds: number[],
): Promise<ScanOrderingDetailSource[]> {
  if (scanOrderIds.length === 0) return [];
  return prisma.scanOrders.findMany({
    where: { id: { in: scanOrderIds } },
    select: {
      id: true,
      marketingSnapshot: true,
      itemOriginalAmount: true,
      specificationExtraAmount: true,
      payableAmount: true,
      items: {
        select: {
          productNameSnapshot: true,
          quantity: true,
          lineTotalAmount: true,
          payableLineAmount: true,
          specs: {
            select: { specOptionNameSnapshot: true },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
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
  // 锁 key 必须与订单号日期段同口径（上海营业日），否则跨零点会串号
  return Number(formatShanghaiDate(date.getTime()).replace(/-/g, ''));
}

export async function generateOrderNo(
  client: Prisma.TransactionClient,
  storeId: number,
  date: Date,
  variant: SalesOrderNoVariant = 'standard',
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
  // 手工补录单与普通销售单各自独立计数（按 manual_entry 区分），
  // 避免两类号段互相挤占序号导致跳号。
  const count = await client.saleOrder.count({
    where: {
      storeId,
      manualEntry: variant === 'manual',
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
  });

  return buildOrderNo(date, count + 1, variant);
}
