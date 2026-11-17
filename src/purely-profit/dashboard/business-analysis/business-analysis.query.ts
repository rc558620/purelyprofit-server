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
  BusinessAnalysisRankSort,
} from './business-analysis.types';
import {
  BUSINESS_ANALYSIS_RANK_LIMIT,
  DEFAULT_BUSINESS_ANALYSIS_RANK_SORT,
} from './business-analysis.types';
import {
  buildCostPreviousTotalSql,
  buildQueryRange,
  buildRankOrderSql,
  buildSalesPreviousCountSql,
  buildSalesPreviousProfitSql,
  buildSalesPreviousRevenueSql,
  compareRankRows,
  compareText,
  executeRankQuery,
  EXCLUDE_VOUCHER_ITEM_SQL,
} from './business-analysis.query.helpers';

export interface BusinessAnalysisMetricsRows {
  salesSummaryRow: BusinessAnalysisSalesSummaryRow;
  salesDailyRows: BusinessAnalysisDailyRevenueRow[];
  salesCategoryRows: BusinessAnalysisCategoryRow[];
  salesRankRows: BusinessAnalysisRankRow[];
  costSummaryRow: BusinessAnalysisCostSummaryRow;
  costDailyRows: BusinessAnalysisDailyCostRow[];
  costBucketRows: BusinessAnalysisCostBucketRow[];
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
  const salesPreviousRevenueSql = buildSalesPreviousRevenueSql(previousRange);
  const salesPreviousCountSql = buildSalesPreviousCountSql(previousRange);
  const salesPreviousProfitSql = buildSalesPreviousProfitSql(previousRange);
  const costPreviousTotalSql = buildCostPreviousTotalSql(previousRange);

  const [salesSummaryRows, salesGroupedRows, costSummaryRows, costGroupedRows] =
    await Promise.all([
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
      // 日趋势 / 品类分布 / 商品排行共享一次 sale_order_items 扫描：
      // GROUPING SETS 一次产出三种粒度，替代原先两条 WHERE 高度重叠的查询
      // 外加独立的排行查询。三种粒度的 ORDER BY 不同，统一在应用层分流后排序。
      prisma.$queryRaw<BusinessAnalysisSalesGroupedRow[]>`
      SELECT
        date_trunc('day', so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
        soi.category_name AS "categoryName",
        soi.product_id AS "productId",
        soi.product_name AS "productName",
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COALESCE(SUM(soi.profit * soi.quantity), 0) AS profit,
        COALESCE(SUM(soi.quantity), 0)::int AS quantity,
        MAX(NULLIF(soi.image, '')) AS image
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
        ${EXCLUDE_VOUCHER_ITEM_SQL}
      GROUP BY GROUPING SETS (
        (date_trunc('day', so.date + interval '8 hours') - interval '8 hours'),
        (soi.category_name),
        (soi.product_id, soi.product_name, soi.category_name)
      )
    `,
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

  // 三种粒度分流：product_name 为 NOT NULL，只有商品排行分组带 productName。
  const salesDailyRows: BusinessAnalysisDailyRevenueRow[] = [];
  const salesCategoryRows: BusinessAnalysisCategoryRow[] = [];
  const salesRankRows: BusinessAnalysisRankRow[] = [];
  for (const row of salesGroupedRows) {
    if (typeof row.productName === 'string') {
      salesRankRows.push({
        productId: row.productId,
        productName: row.productName,
        categoryName: row.categoryName ?? '',
        totalRevenue: Number(row.revenue ?? 0),
        totalProfit: Number(row.profit ?? 0),
        quantity: row.quantity,
        image: row.image,
      });
      continue;
    }
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
  // 还原被合并掉的各条 SQL 的排序：先按 rankSort 排序再截断，与原先
  // ORDER BY + LIMIT 语义一致；日趋势按时间升序、品类按收入降序。
  salesRankRows.sort((a, b) => compareRankRows(a, b, rankSort));
  const rankedProducts = salesRankRows.slice(0, BUSINESS_ANALYSIS_RANK_LIMIT);
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
    salesRankRows: rankedProducts,
    costSummaryRow: {
      currentTotalCost: Number(costSummaryRows[0]?.currentTotalCost ?? 0),
      previousTotalCost: Number(costSummaryRows[0]?.previousTotalCost ?? 0),
    },
    costDailyRows,
    costBucketRows,
  };
}
