import { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SaleOrderWithItems } from './sales-record.domain';
import type {
  ScanOrderingDetailSource,
  SpaceSessionSpecSource,
} from './sales-record-enrichment';
import type { SalesPeriodRange } from './sales-record.utils';
import {
  buildSalesRecordListCursorWhere,
  SALES_RECORD_LIST_ORDER_BY,
} from './sales-record-list.cursor';
import type { SalesRecordListCursor } from './sales-record-list.cursor';

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
  // 从 sale_order_items 聚合，排除预付款/续费抵扣行，只算实际消费。
  // 口径与列表 / 报表 / CSV 完全一致（详见 resolveSalesRecordAmounts）：
  // - 台位费计入金额（按时间计费也是真实营收）；
  // - 团购券订单（顾客用券支付且券面有效）：券程台位费按券面金额计收，
  //   超时台位费（实际台位费 − 券预设的 1 小时台位费）由顾客到店另付，点单全额；
  // - 已退款订单不计入（与列表卡片 +¥0、报表/CSV 跳过退款单同口径）。
  // 改写：原 SQL 用 SUM(DISTINCT sor.amount) 去重退款金额，语义有误
  //（相同金额的退款行会被错误去重），且三表 JOIN 在 sale_order_items
  // 大表上产生笛卡尔积。改为子查询预聚合：先按 order_id 聚合 items、
  // refunds 与会话时薪，再在主查询中做加减，消除 DISTINCT 语义风险。
  // 笔数只统计有效订单（排除退款单），与营收 / 利润 / CSV 汇总 / 报表
  // orderCount 完全同口径：否则「营业额已排除退款、客单价却按含退款单的
  // 笔数相除」，同一周期在销售卡片与导出文件里会得到两个客单价。
  // 列表分页的 meta.total 仍是全部单据（列表本身要展示退款单），两者语义不同，
  // 不要为了对齐而把退款单塞回经营统计。
  // ⚠️ 性能：三个明细 CTE 必须先用 scoped_orders 做 semi-join 收敛范围。
  // 原始写法让 soi_agg / sor_agg / ss_agg 对全表 GROUP BY，门店与日期过滤
  // 直到最外层 per_order 才生效——数据量增长后聚合成本与全店历史成正比。
  // 下推后各 CTE 只处理当期订单的明细行，且 sale_order_items(order_id)、
  // sale_order_refunds(sale_order_id)、space_sessions(sale_order_id) 三处
  // 都有索引可用。语义等价：原 SQL 的聚合结果最终也只与 per_order 命中的
  // 订单做 LEFT JOIN，落在外面的聚合行不会贡献任何输出。
  const result = await prisma.$queryRaw<
    [
      {
        revenue: Prisma.Decimal | null;
        profit: Prisma.Decimal | null;
        order_count: bigint;
      },
    ]
  >`
    WITH scoped_orders AS (
      SELECT id
      FROM sale_orders
      WHERE store_id = ${storeId}
        AND date >= ${new Date(range.start)}
        AND date <= ${new Date(range.end)}
    ),
    soi_agg AS (
      SELECT order_id,
             SUM(CASE WHEN product_name ~ '^台位费(（|\\s|$)' THEN 0
                      ELSE sale_price * quantity END) AS other_revenue,
             SUM(CASE WHEN product_name ~ '^台位费(（|\\s|$)' THEN 0
                      ELSE profit * quantity END) AS other_profit,
             SUM(CASE WHEN product_name ~ '^台位费(（|\\s|$)' THEN sale_price * quantity
                      ELSE 0 END) AS table_fee_revenue,
             SUM(CASE WHEN product_name ~ '^台位费(（|\\s|$)' THEN profit * quantity
                      ELSE 0 END) AS table_fee_profit
      FROM sale_order_items
      WHERE product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
        AND order_id IN (SELECT id FROM scoped_orders)
      GROUP BY order_id
    ),
    sor_agg AS (
      SELECT sale_order_id,
             SUM(amount) AS refund_amount
      FROM sale_order_refunds
      WHERE sale_order_id IN (SELECT id FROM scoped_orders)
      GROUP BY sale_order_id
    ),
    ss_agg AS (
      SELECT sale_order_id,
             MAX(hourly_rate) AS hourly_rate
      FROM space_sessions
      WHERE sale_order_id IS NOT NULL
        AND sale_order_id IN (SELECT id FROM scoped_orders)
      GROUP BY sale_order_id
    ),
    per_order AS (
      SELECT so.id,
             -- 退款单参与行计算（金额已归零）但计入 is_refunded，供外层扣减笔数
             (sor_agg.refund_amount IS NOT NULL) AS is_refunded,
             CASE
               WHEN sor_agg.refund_amount IS NOT NULL THEN 0
               WHEN so.voucher_face_amount > 0
                    AND (so.customer_payment_method = 'groupon_voucher'
                         OR so.payment_method::text = 'groupon_voucher')
                    AND COALESCE(soi_agg.table_fee_revenue, 0) > 0
               THEN COALESCE(soi_agg.other_revenue, 0)
                    -- 券实际抵扣 = min(券程内台位费, 券面)，券面大于消费时按消费计，
                    -- 多付的券面在结账时退回顾客（产品口径：超额按退款处理），不计入营业额
                    + LEAST(
                        LEAST(COALESCE(soi_agg.table_fee_revenue, 0),
                              COALESCE(ss_agg.hourly_rate,
                                       soi_agg.table_fee_revenue)),
                        so.voucher_face_amount)
                    + GREATEST(COALESCE(soi_agg.table_fee_revenue, 0)
                               - COALESCE(ss_agg.hourly_rate,
                                          soi_agg.table_fee_revenue), 0)
               ELSE COALESCE(soi_agg.other_revenue, 0)
                    + COALESCE(soi_agg.table_fee_revenue, 0)
             END AS order_revenue,
             CASE
               WHEN sor_agg.refund_amount IS NOT NULL THEN 0
               WHEN so.voucher_face_amount > 0
                    AND (so.customer_payment_method = 'groupon_voucher'
                         OR so.payment_method::text = 'groupon_voucher')
                    AND COALESCE(soi_agg.table_fee_revenue, 0) > 0
               THEN COALESCE(soi_agg.other_profit, 0)
                    + LEAST(
                        LEAST(COALESCE(soi_agg.table_fee_revenue, 0),
                              COALESCE(ss_agg.hourly_rate,
                                       soi_agg.table_fee_revenue)),
                        so.voucher_face_amount)
                    + GREATEST(COALESCE(soi_agg.table_fee_revenue, 0)
                               - COALESCE(ss_agg.hourly_rate,
                                          soi_agg.table_fee_revenue), 0)
               ELSE COALESCE(soi_agg.other_profit, 0)
                    + COALESCE(soi_agg.table_fee_profit, 0)
             END AS order_profit
      FROM sale_orders so
      LEFT JOIN soi_agg ON soi_agg.order_id = so.id
      LEFT JOIN sor_agg ON sor_agg.sale_order_id = so.id
      LEFT JOIN ss_agg ON ss_agg.sale_order_id = so.id
      WHERE so.store_id = ${storeId}
        AND so.date >= ${new Date(range.start)}
        AND so.date <= ${new Date(range.end)}
    )
    SELECT
      COALESCE(SUM(order_revenue), 0) AS revenue,
      COALESCE(SUM(order_profit), 0) AS profit,
      COUNT(*) FILTER (WHERE NOT is_refunded) AS order_count
    FROM per_order
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
    /**
     * 列表接口的游标条件（`(date, id)` 复合键）。
     *
     * 条件写进 where 而不传 skip：Prisma 的 `cursor` 是「按唯一键定位锚点行」，
     * 本接口直接按 (date, id) 逐级比较更直观，也避免两条分页路径混用。
     * CSV 分批扫描走 `querySaleOrdersForCsv`，与本函数互不影响。
     */
    listCursor?: SalesRecordListCursor | null;
  },
): Promise<SaleOrderWithItems[]> {
  const baseWhere: Prisma.SaleOrderWhereInput = {
    storeId: params.storeId,
    date: {
      gte: new Date(params.range.start),
      lte: new Date(params.range.end),
    },
  };

  return prisma.saleOrder.findMany({
    where: params.listCursor
      ? { AND: [baseWhere, buildSalesRecordListCursorWhere(params.listCursor)] }
      : baseWhere,
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
          // 券程可抵台位费（分）：券预设的 1 小时台位费 / 固定价
          hourlyRate: true,
          space: {
            select: {
              name: true,
            },
          },
          // 续费记录：按支付方式拆分「实付金额」的收款来源
          sessionRenewRecords: {
            select: {
              amount: true,
              paymentMethod: true,
              voucherFaceAmount: true,
            },
            orderBy: [{ id: 'asc' }],
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
    orderBy: SALES_RECORD_LIST_ORDER_BY,
    // 游标路径不带 skip，否则每页会少一行（游标条件已在 where 中表达）
    skip: params.listCursor ? undefined : params.skip,
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

/**
 * 批量查询销售记录关联的空间会话商品行规格（非扫码订单增强数据源）：
 * 空间结账的 saleOrderItem 由 sessionItems 行级复制，specNames 按行对应。
 */
export async function querySpaceSessionSpecDetails(
  prisma: PrismaService,
  saleOrderIds: number[],
): Promise<SpaceSessionSpecSource[]> {
  if (saleOrderIds.length === 0) return [];
  return prisma.spaceSession.findMany({
    where: { saleOrderId: { in: saleOrderIds } },
    select: {
      id: true,
      // 调用方按 SaleOrder.id 关联，必须返回该外键作为 map key
      saleOrderId: true,
      sessionItems: {
        select: {
          productName: true,
          quantity: true,
          specNames: true,
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

// 订单号生成已外移到 sales-record-order-no.query.ts（本文件已超 400 行），
// 此处保持 re-export，调用方引用路径不变。
export { generateOrderNo } from './sales-record-order-no.query';
