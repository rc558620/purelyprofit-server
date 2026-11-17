import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisRange,
  BusinessAnalysisRankRow,
  BusinessAnalysisRankSort,
} from './business-analysis.types';
import { BUSINESS_ANALYSIS_RANK_LIMIT } from './business-analysis.types';
import { resolveAnalysisQueryRange } from './business-analysis.utils';

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
            AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
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
            AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
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
 * 商品排行 / 品类分布需额外剔除的「券面消费行」条件。
 *
 * 纯消费模式开台团购券会落一条「XX（团购券）」正向行：它是券面金额的记账载体，
 * 不是真实商品，进商品利润排行 / 品类分布会凭空多出一个「商品」。
 * ⚠️ 营业额汇总（sales-record.query / 统计卡 / 报表）**不**排除该行——
 * 券面是门店真实营收，排除会让营业额漏掉这笔收入。
 */
// 双条件（后缀 + 系统分类）排除券面行：商家自建商品若恰好以「（团购券）」结尾
// 仍能正常进入排行榜，只有系统写入的券面行（分类固定为「团购券」）被排除。
export const EXCLUDE_VOUCHER_ITEM_SQL = Prisma.sql`
        AND NOT (soi.product_name LIKE '%（团购券）' AND soi.category_name = '团购券')`;

/**
 * 排行排序子句：由前端透传的排序维度决定，服务端排序后再截断，
 * 避免「按利润截断后前端再按收入/销量排序」导致的排名错误。
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
 * 稳定的文本升序比较，替代 localeCompare：后者受 ICU 区域规则影响，
 * 与 PG 侧 ORDER BY 的排序结果可能不一致（同名/同额行的顺序会跳变）。
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 与 buildRankOrderSql 的三种排序维度严格一致，用于把排行截断从 SQL 侧
 * 移到应用层后仍保持「先按维度排序、再截断」的原有语义。
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
    WHERE soi.store_id = ${storeId}
      AND so.date >= ${new Date(currentRange.start)}
      AND so.date <= ${new Date(currentRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
      ${EXCLUDE_VOUCHER_ITEM_SQL}
    GROUP BY soi.product_id, soi.product_name, soi.category_name
    ORDER BY ${rankOrderSql}
    LIMIT ${BUSINESS_ANALYSIS_RANK_LIMIT}
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
