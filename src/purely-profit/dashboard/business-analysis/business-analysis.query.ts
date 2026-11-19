import type { PrismaService } from '../../../prisma/prisma.service';
import { isGrouponVoucherItemName } from '../../commerce/commerce.utils';
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
import { compareText } from './business-analysis.utils';
import { DEFAULT_BUSINESS_ANALYSIS_RANK_SORT } from './business-analysis.types';
import {
  buildCostPreviousTotalSql,
  buildQueryRange,
  buildRankOrderSql,
  buildSalesPreviousCountSql,
  buildSalesPreviousProfitSql,
  buildSalesPreviousRevenueSql,
  compareRankRows,
  executeRankQuery,
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

/**
 * 经营分析取数：汇总 / 日趋势 / 品类 / 排行 / 成本共用同一份「有效销售单」基集。
 *
 * 有效销售单与 profit-detail、sales-record 对齐：
 * - 存在 sale_order_refunds 行的订单整体排除（退款只写退款表，不改明细行，
 *   不排除会让退款单的收入、利润、单数、排行全部照算）；
 * - 预付款 / 预付抵扣 / 续费抵扣 / 自助下单抵扣行不计入金额（避免与对应商品行重复）；
 * - 券面消费行（「XX（团购券）」）**计入金额与日趋势**，仅在排行 / 品类维度剔除。
 */
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
      LEFT JOIN sale_order_refunds sor ON sor.sale_order_id = so.id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(queryRange.start)}
        AND so.date <= ${new Date(queryRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣', '自助下单抵扣')
        AND sor.id IS NULL
    `,
      // 日趋势 / 品类分布 / 商品排行共享一次 sale_order_items 扫描。
      // 只产出「日」与「商品」两种粒度：品类由商品行在应用层汇总——
      // 券面消费行只允许从排行 / 品类剔除、必须留在日趋势里，SQL WHERE 无法
      // 按粒度区分，放到应用层才能同时满足两种口径。
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
      LEFT JOIN sale_order_refunds sor ON sor.sale_order_id = so.id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣', '自助下单抵扣')
        AND sor.id IS NULL
      GROUP BY GROUPING SETS (
        (date_trunc('day', so.date + interval '8 hours') - interval '8 hours'),
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
        -- 采购成本记录（source_type='purchase'）不再作为经营费用扣减：
        -- 销售行 profit 已按「售价 − 成本价」扣过商品成本，再扣一次会把同一批
        -- 已售商品成本重复计入，并把未售库存提前计入当期损益。
        -- 手工录入的成本记录（含手工记的进货）仍按经营费用处理。
        AND cr.source_type <> 'purchase'
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
        AND cr.source_type <> 'purchase'
        AND cr.date >= ${new Date(currentRange.start)}
        AND cr.date <= ${new Date(currentRange.end)}
      GROUP BY GROUPING SETS (
        (date_trunc('day', cr.date + interval '8 hours') - interval '8 hours'),
        (cr.category)
      )
    `,
    ]);

  // 两种粒度分流：商品分组带 productName；日分组只有 bucketAt（categoryName 为 NULL）。
  const salesDailyRows: BusinessAnalysisDailyRevenueRow[] = [];
  const salesRankRows: BusinessAnalysisRankRow[] = [];
  for (const row of salesGroupedRows) {
    if (typeof row.productName === 'string') {
      // 券面消费行不是真实商品：不进排行 / 品类；金额仍留在日趋势（SQL 不再排除）
      if (
        isGrouponVoucherItemName(row.productName, row.categoryName ?? undefined)
      ) {
        continue;
      }
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
    }
  }

  // 品类由商品分组在应用层汇总：与排行共用同一份扫描与同一套券面排除规则，
  // 不再需要独立的 category GROUPING SET。日趋势按时间升序、品类按收入降序。
  const salesCategoryRows = buildCategoryRows(salesRankRows);
  salesDailyRows.sort((a, b) => a.bucketAt.getTime() - b.bucketAt.getTime());

  // 先按 rankSort 排序（决定同一商品多段名称时沿用哪一组名称），
  // 但**不在这里截断**：截断必须发生在按 productId 合并之后
  // （见 domain.sortAndLimitRankMap），否则改名商品会在合并前被切掉。
  salesRankRows.sort((a, b) => compareRankRows(a, b, rankSort));

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

/**
 * 由商品分组汇总品类分布。
 *
 * 入参已按券面消费行过滤，且同商品多段名称的快照行在这里会被自然合并
 * （按 categoryName 累加）。无分类名的行不计入品类，避免出现空分类项。
 */
function buildCategoryRows(
  rankRows: BusinessAnalysisRankRow[],
): BusinessAnalysisCategoryRow[] {
  const categoryMap = new Map<string, BusinessAnalysisCategoryRow>();
  for (const row of rankRows) {
    if (!row.categoryName) {
      continue;
    }
    const existing = categoryMap.get(row.categoryName);
    if (existing) {
      existing.revenue += row.totalRevenue;
      existing.profit += row.totalProfit;
      existing.quantity += row.quantity;
      continue;
    }
    categoryMap.set(row.categoryName, {
      categoryName: row.categoryName,
      revenue: row.totalRevenue,
      profit: row.totalProfit,
      quantity: row.quantity,
    });
  }

  return Array.from(categoryMap.values()).sort(
    (a, b) =>
      b.revenue - a.revenue || compareText(a.categoryName, b.categoryName),
  );
}
