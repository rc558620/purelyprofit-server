import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisCategoryRow,
  BusinessAnalysisCostBucketRow,
  BusinessAnalysisCostGroupedRow,
  BusinessAnalysisCostSummaryRow,
  BusinessAnalysisDailyCostRow,
  BusinessAnalysisDailyRevenueRow,
  BusinessAnalysisRankRow,
  BusinessAnalysisSalesGroupedRow,
  BusinessAnalysisSalesSummaryRow,
  BusinessAnalysisRange,
  BusinessAnalysisRankSort,
} from './business-analysis.types';
import {
  BUSINESS_ANALYSIS_RANK_LIMIT,
  DEFAULT_BUSINESS_ANALYSIS_RANK_SORT,
} from './business-analysis.types';
import { resolveAnalysisQueryRange } from './business-analysis.utils';

export interface BusinessAnalysisMetricsRows {
  salesSummaryRow: BusinessAnalysisSalesSummaryRow;
  salesDailyRows: BusinessAnalysisDailyRevenueRow[];
  salesCategoryRows: BusinessAnalysisCategoryRow[];
  salesRankRows: BusinessAnalysisRankRow[];
  costSummaryRow: BusinessAnalysisCostSummaryRow;
  costDailyRows: BusinessAnalysisDailyCostRow[];
  costBucketRows: BusinessAnalysisCostBucketRow[];
}

function buildSalesPreviousRevenueSql(
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

function buildSalesPreviousProfitSql(
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

function buildSalesPreviousCountSql(
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

function buildCostPreviousTotalSql(
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

function buildQueryRange(
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
const EXCLUDE_VOUCHER_ITEM_SQL = Prisma.sql`
        AND NOT (soi.product_name LIKE '%（团购券）' AND soi.category_name = '团购券')`;

/**
 * 排行排序子句：由前端透传的排序维度决定，服务端排序后再截断，
 * 避免「按利润截断后前端再按收入/销量排序」导致的排名错误。
 * 末级统一用商品名兜底，保证同值行的顺序稳定。
 */
function buildRankOrderSql(rankSort: BusinessAnalysisRankSort): Prisma.Sql {
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
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 商品利润排行查询。抽成独立函数，供完整分析与 CSV 导出（只需排行）两条路径共用。
 */
async function executeRankQuery(
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

/**
 * 只取商品利润排行，CSV 导出专用。
 * 导出仅用到 rankProducts，走这条路径可省掉汇总/趋势/品类/成本等其余全部查询。
 */
export async function fetchBusinessAnalysisRank(
  prisma: PrismaService,
  storeId: number,
  currentRange: BusinessAnalysisAccessibleRange,
  rankSort: BusinessAnalysisRankSort = DEFAULT_BUSINESS_ANALYSIS_RANK_SORT,
): Promise<BusinessAnalysisRankRow[]> {
  return executeRankQuery(
    prisma,
    storeId,
    currentRange,
    buildRankOrderSql(rankSort),
  );
}

export async function fetchBusinessAnalysisMetrics(
  prisma: PrismaService,
  storeId: number,
  currentRange: BusinessAnalysisAccessibleRange,
  previousRange: BusinessAnalysisAccessibleRange,
  rankSort: BusinessAnalysisRankSort = DEFAULT_BUSINESS_ANALYSIS_RANK_SORT,
): Promise<BusinessAnalysisMetricsRows> {
  const queryRange = buildQueryRange(currentRange, previousRange);
  const rankOrderSql = buildRankOrderSql(rankSort);
  const salesPreviousRevenueSql = buildSalesPreviousRevenueSql(previousRange);
  const salesPreviousCountSql = buildSalesPreviousCountSql(previousRange);
  const salesPreviousProfitSql = buildSalesPreviousProfitSql(previousRange);
  const costPreviousTotalSql = buildCostPreviousTotalSql(previousRange);

  const [
    salesSummaryRows,
    salesGroupedRows,
    salesRankRows,
    costSummaryRows,
    costGroupedRows,
  ] = await Promise.all([
    prisma.$queryRaw<BusinessAnalysisSalesSummaryRow[]>`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN so.date >= ${new Date(currentRange.start)}
                AND so.date <= ${new Date(currentRange.end)}
              THEN soi.sale_price * soi.quantity
              ELSE 0
            END
          ),
          0
        ) AS "currentRevenue",
      COUNT(DISTINCT so.id) FILTER (
        WHERE so.date >= ${new Date(currentRange.start)}
          AND so.date <= ${new Date(currentRange.end)}
      )::int AS "currentOrderCount",
        ${salesPreviousRevenueSql} AS "previousRevenue",
        ${salesPreviousCountSql} AS "previousOrderCount",
      COALESCE(
        SUM(
          CASE
            WHEN so.date >= ${new Date(currentRange.start)}
              AND so.date <= ${new Date(currentRange.end)}
            THEN soi.profit * soi.quantity
            ELSE 0
          END
        ),
        0
      ) AS "currentProfit",
        ${salesPreviousProfitSql} AS "previousProfit"
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(queryRange.start)}
        AND so.date <= ${new Date(queryRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    `,
    // 日趋势与品类分布共享一次表扫描：GROUPING SETS 一次产出两种粒度，
    // 替代原先两条 WHERE 完全相同、各扫一遍 sale_order_items 的查询。
    // 两种粒度的 ORDER BY 不同，统一在应用层分流后排序。
    prisma.$queryRaw<BusinessAnalysisSalesGroupedRow[]>`
      SELECT
        date_trunc('day', so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
        soi.category_name AS "categoryName",
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COALESCE(SUM(soi.profit * soi.quantity), 0) AS profit,
        COALESCE(SUM(soi.quantity), 0)::int AS quantity
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
        ${EXCLUDE_VOUCHER_ITEM_SQL}
      GROUP BY GROUPING SETS (
        (date_trunc('day', so.date + interval '8 hours') - interval '8 hours'),
        (soi.category_name)
      )
    `,
    executeRankQuery(prisma, storeId, currentRange, rankOrderSql),
    prisma.$queryRaw<BusinessAnalysisCostSummaryRow[]>`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN cr.date >= ${new Date(currentRange.start)}
                AND cr.date <= ${new Date(currentRange.end)}
              THEN cr.amount
              ELSE 0
            END
          ),
          0
        ) AS "currentTotalCost",
        ${costPreviousTotalSql} AS "previousTotalCost"
      FROM cost_records cr
      WHERE cr.store_id = ${storeId}
        AND cr.date >= ${new Date(queryRange.start)}
        AND cr.date <= ${new Date(queryRange.end)}
    `,
    // 同上：成本日趋势与成本构成共享一次 cost_records 扫描
    prisma.$queryRaw<BusinessAnalysisCostGroupedRow[]>`
      SELECT
        date_trunc('day', cr.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
        cr.category AS category,
        COALESCE(SUM(cr.amount), 0) AS amount
      FROM cost_records cr
      WHERE cr.store_id = ${storeId}
        AND cr.date >= ${new Date(currentRange.start)}
        AND cr.date <= ${new Date(currentRange.end)}
      GROUP BY GROUPING SETS (
        (date_trunc('day', cr.date + interval '8 hours') - interval '8 hours'),
        (cr.category)
      )
    `,
  ]);

  // 把 GROUPING SETS 的两种粒度分流还原成原来的两组行：
  // 日趋势行 bucketAt 非空、品类行 categoryName 非空。
  const salesDailyRows: BusinessAnalysisDailyRevenueRow[] = [];
  const salesCategoryRows: BusinessAnalysisCategoryRow[] = [];
  for (const row of salesGroupedRows) {
    if (row.bucketAt !== null) {
      salesDailyRows.push({
        bucketAt: row.bucketAt,
        revenue: Number(row.revenue ?? 0),
        profit: Number(row.profit ?? 0),
      });
      continue;
    }
    if (row.categoryName !== null) {
      salesCategoryRows.push({
        categoryName: row.categoryName,
        revenue: Number(row.revenue ?? 0),
        profit: Number(row.profit ?? 0),
        quantity: row.quantity,
      });
    }
  }
  // 还原被合并掉的两条 SQL 各自的排序：日趋势按时间升序、品类按收入降序
  salesDailyRows.sort((a, b) => a.bucketAt.getTime() - b.bucketAt.getTime());
  salesCategoryRows.sort(
    (a, b) =>
      b.revenue - a.revenue || compareText(a.categoryName, b.categoryName),
  );

  const costDailyRows: BusinessAnalysisDailyCostRow[] = [];
  const costBucketRows: BusinessAnalysisCostBucketRow[] = [];
  for (const row of costGroupedRows) {
    if (row.bucketAt !== null) {
      costDailyRows.push({
        bucketAt: row.bucketAt,
        amount: Number(row.amount ?? 0),
      });
      continue;
    }
    if (row.category !== null) {
      costBucketRows.push({
        category: row.category,
        amount: Number(row.amount ?? 0),
      });
    }
  }
  costDailyRows.sort((a, b) => a.bucketAt.getTime() - b.bucketAt.getTime());
  costBucketRows.sort(
    (a, b) => b.amount - a.amount || compareText(a.category, b.category),
  );

  return {
    salesSummaryRow: {
      currentRevenue: Number(salesSummaryRows[0]?.currentRevenue ?? 0),
      currentOrderCount: salesSummaryRows[0]?.currentOrderCount ?? 0,
      previousRevenue: Number(salesSummaryRows[0]?.previousRevenue ?? 0),
      previousOrderCount: salesSummaryRows[0]?.previousOrderCount ?? 0,
      currentProfit: Number(salesSummaryRows[0]?.currentProfit ?? 0),
      previousProfit: Number(salesSummaryRows[0]?.previousProfit ?? 0),
    },
    salesDailyRows,
    salesCategoryRows,
    salesRankRows,
    costSummaryRow: {
      currentTotalCost: Number(costSummaryRows[0]?.currentTotalCost ?? 0),
      previousTotalCost: Number(costSummaryRows[0]?.previousTotalCost ?? 0),
    },
    costDailyRows,
    costBucketRows,
  };
}
