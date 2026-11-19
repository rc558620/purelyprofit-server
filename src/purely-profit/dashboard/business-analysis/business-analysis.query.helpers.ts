import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisRange,
  BusinessAnalysisRankRow,
  BusinessAnalysisRankSort,
} from './business-analysis.types';
import {
  compareText,
  resolveAnalysisQueryRange,
} from './business-analysis.utils';

/**
 * 经营分析查询的 SQL 片段与排行辅助。
 *
 * 从 `business-analysis.query` 抽离：这里只做 SQL 拼装与排序口径，
 * 主文件专注于「取数 → 组装响应」。
 */

/** 对比期销售额子查询片段 */
export function buildSalesPreviousRevenueSql(
  previousRange: BusinessAnalysisAccessibleRange,
): Prisma.Sql {
  if (previousRange.empty) {
    return Prisma.sql`0::numeric`;
  }

  return Prisma.sql`
    COALESCE(
      SUM(
        CASE
          WHEN so.date >= ${new Date(previousRange.start)}
            AND so.date <= ${new Date(previousRange.end)}
            AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣', '自助下单抵扣')
          THEN soi.sale_price * soi.quantity
          ELSE 0
        END
      ),
      0
    )
  `;
}

/** 对比期利润子查询片段 */
export function buildSalesPreviousProfitSql(
  previousRange: BusinessAnalysisAccessibleRange,
): Prisma.Sql {
  if (previousRange.empty) {
    return Prisma.sql`0::numeric`;
  }

  return Prisma.sql`
    COALESCE(
      SUM(
        CASE
          WHEN so.date >= ${new Date(previousRange.start)}
            AND so.date <= ${new Date(previousRange.end)}
            AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣', '自助下单抵扣')
          THEN soi.profit * soi.quantity
          ELSE 0
        END
      ),
      0
    )
  `;
}

/** 对比期订单数子查询片段 */
export function buildSalesPreviousCountSql(
  previousRange: BusinessAnalysisAccessibleRange,
): Prisma.Sql {
  if (previousRange.empty) {
    return Prisma.sql`0::int`;
  }

  return Prisma.sql`
    COUNT(DISTINCT so.id) FILTER (
      WHERE so.date >= ${new Date(previousRange.start)}
        AND so.date <= ${new Date(previousRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    )::int
  `;
}

/** 对比期成本合计子查询片段 */
export function buildCostPreviousTotalSql(
  previousRange: BusinessAnalysisAccessibleRange,
): Prisma.Sql {
  if (previousRange.empty) {
    return Prisma.sql`0::numeric`;
  }

  return Prisma.sql`
    COALESCE(
      SUM(
        CASE
          WHEN cr.date >= ${new Date(previousRange.start)}
            AND cr.date <= ${new Date(previousRange.end)}
          THEN cr.amount
          ELSE 0
        END
      ),
      0
    )
  `;
}

/** 合并当期与对比期的查询范围 */
export function buildQueryRange(
  currentRange: BusinessAnalysisAccessibleRange,
  previousRange: BusinessAnalysisAccessibleRange,
): BusinessAnalysisRange {
  return resolveAnalysisQueryRange(currentRange, previousRange);
}

/**
 * 商品排行 / 品类分布需剔除的「券面消费行」判定。
 *
 * 纯消费模式开台团购券会落一条「XX（团购券）」正向行：它是券面金额的记账载体，
 * 不是真实商品，进商品利润排行 / 品类分布会凭空多出一个「商品」。
 * ⚠️ 营业额与日趋势（heroSummary / dailyTrend）**不**排除该行——券面是门店
 * 真实营收，排除会让总额与趋势合计对不上。因此该条件不再写成 SQL WHERE，
 * 而是按维度在应用层排除（见 business-analysis.query / domain）：
 * 同一份扫描结果在日趋势维度保留券面，在排行/品类维度剔除。
 */

/**
 * 排行排序子句：决定「同一商品多段名称快照」时哪一组名称被沿用
 * （先出现的分组利润最高），真正的截断发生在按 productId 合并之后
 * （见 domain.sortAndLimitRankMap），两者不能颠倒。
 * 末级统一用商品名兜底，保证同值行的顺序稳定。
 */
export function buildRankOrderSql(
  rankSort: BusinessAnalysisRankSort,
): Prisma.Sql {
  switch (rankSort) {
    case 'revenue':
      return Prisma.sql`"totalRevenue" DESC, "totalProfit" DESC, soi.product_name ASC`;
    case 'quantity':
      return Prisma.sql`quantity DESC, "totalProfit" DESC, soi.product_name ASC`;
    default:
      return Prisma.sql`"totalProfit" DESC, "totalRevenue" DESC, soi.product_name ASC`;
  }
}

/**
 * 与 buildRankOrderSql 的三种排序维度严格一致，用于应用层排序：
 * 先按维度排序（决定合并时沿用哪一组的名称），合并后再按同一口径重排并截断。
 */
export function compareRankRows(
  a: BusinessAnalysisRankRow,
  b: BusinessAnalysisRankRow,
  rankSort: BusinessAnalysisRankSort,
): number {
  switch (rankSort) {
    case 'revenue':
      return (
        b.totalRevenue - a.totalRevenue ||
        b.totalProfit - a.totalProfit ||
        compareText(a.productName, b.productName)
      );
    case 'quantity':
      return (
        b.quantity - a.quantity ||
        b.totalProfit - a.totalProfit ||
        compareText(a.productName, b.productName)
      );
    default:
      return (
        b.totalProfit - a.totalProfit ||
        b.totalRevenue - a.totalRevenue ||
        compareText(a.productName, b.productName)
      );
  }
}

/**
 * 商品利润排行查询。抽成独立函数，供完整分析与 CSV 导出（只需排行）两条路径共用。
 *
 * 不做 LIMIT：SQL 按 (product_id, product_name, category_name) 分组，同一商品
 * 改名后会返回多行，必须在应用层按 productId 合并后才能排序截断，否则
 * 「合并前截断」会把本应进榜的商品整段丢掉（见 domain.sortAndLimitRankMap）。
 */
export async function executeRankQuery(
  prisma: PrismaService,
  storeId: number,
  currentRange: BusinessAnalysisAccessibleRange,
  rankOrderSql: Prisma.Sql,
): Promise<BusinessAnalysisRankRow[]> {
  const rows = await prisma.$queryRaw<BusinessAnalysisRankRow[]>`
    SELECT
      soi.product_id AS "productId",
      soi.product_name AS "productName",
      soi.category_name AS "categoryName",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS "totalRevenue",
      COALESCE(SUM(soi.profit * soi.quantity), 0) AS "totalProfit",
      COALESCE(SUM(soi.quantity), 0)::int AS quantity,
      MAX(NULLIF(soi.image, '')) AS image
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    LEFT JOIN sale_order_refunds sor ON sor.sale_order_id = so.id
    WHERE soi.store_id = ${storeId}
      AND so.date >= ${new Date(currentRange.start)}
      AND so.date <= ${new Date(currentRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣', '自助下单抵扣')
      AND sor.id IS NULL
    GROUP BY soi.product_id, soi.product_name, soi.category_name
    ORDER BY ${rankOrderSql}
  `;

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    categoryName: r.categoryName,
    totalRevenue: Number(r.totalRevenue ?? 0),
    totalProfit: Number(r.totalProfit ?? 0),
    quantity: r.quantity,
    image: r.image,
  }));
}
