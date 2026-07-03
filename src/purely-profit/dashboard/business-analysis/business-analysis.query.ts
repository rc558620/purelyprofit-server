import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisCategoryRow,
  BusinessAnalysisCostBucketRow,
  BusinessAnalysisCostSummaryRow,
  BusinessAnalysisDailyCostRow,
  BusinessAnalysisDailyRevenueRow,
  BusinessAnalysisRankRow,
  BusinessAnalysisSalesSummaryRow,
  BusinessAnalysisRange,
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

function buildSalesPreviousCountSql(
  previousRange: BusinessAnalysisAccessibleRange,
): Prisma.Sql {
  if (previousRange.empty) {
    return Prisma.sql`0::int`;
  }

  return Prisma.sql`
    COUNT(*) FILTER (
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

export async function fetchBusinessAnalysisMetrics(
  prisma: PrismaService,
  storeId: number,
  currentRange: BusinessAnalysisAccessibleRange,
  previousRange: BusinessAnalysisAccessibleRange,
): Promise<BusinessAnalysisMetricsRows> {
  const queryRange = buildQueryRange(currentRange, previousRange);
  const salesPreviousRevenueSql = buildSalesPreviousRevenueSql(previousRange);
  const salesPreviousCountSql = buildSalesPreviousCountSql(previousRange);
  const costPreviousTotalSql = buildCostPreviousTotalSql(previousRange);

  const [
    salesSummaryRows,
    salesDailyRows,
    salesCategoryRows,
    salesRankRows,
    costSummaryRows,
    costDailyRows,
    costBucketRows,
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
        COUNT(*) FILTER (
          WHERE so.date >= ${new Date(currentRange.start)}
            AND so.date <= ${new Date(currentRange.end)}
        )::int AS "currentOrderCount",
        ${salesPreviousRevenueSql} AS "previousRevenue",
        ${salesPreviousCountSql} AS "previousOrderCount"
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(queryRange.start)}
        AND so.date <= ${new Date(queryRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    `,
    prisma.$queryRaw<BusinessAnalysisDailyRevenueRow[]>`
      SELECT
        date_trunc('day', so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<BusinessAnalysisCategoryRow[]>`
      SELECT
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
      GROUP BY soi.category_name
      ORDER BY revenue DESC, soi.category_name ASC
    `,
    prisma.$queryRaw<BusinessAnalysisRankRow[]>`
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
      GROUP BY soi.product_id, soi.product_name, soi.category_name
      ORDER BY "totalProfit" DESC, "totalRevenue" DESC, soi.product_name ASC
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
    prisma.$queryRaw<BusinessAnalysisDailyCostRow[]>`
      SELECT
        date_trunc('day', cr.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
        COALESCE(SUM(cr.amount), 0) AS amount
      FROM cost_records cr
      WHERE cr.store_id = ${storeId}
        AND cr.date >= ${new Date(currentRange.start)}
        AND cr.date <= ${new Date(currentRange.end)}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<BusinessAnalysisCostBucketRow[]>`
      SELECT
        cr.category,
        COALESCE(SUM(cr.amount), 0) AS amount
      FROM cost_records cr
      WHERE cr.store_id = ${storeId}
        AND cr.date >= ${new Date(currentRange.start)}
        AND cr.date <= ${new Date(currentRange.end)}
      GROUP BY cr.category
      ORDER BY amount DESC, cr.category ASC
    `,
  ]);

  return {
    salesSummaryRow: {
      currentRevenue: Number(salesSummaryRows[0]?.currentRevenue ?? 0),
      currentOrderCount: salesSummaryRows[0]?.currentOrderCount ?? 0,
      previousRevenue: Number(salesSummaryRows[0]?.previousRevenue ?? 0),
      previousOrderCount: salesSummaryRows[0]?.previousOrderCount ?? 0,
    },
    salesDailyRows: salesDailyRows.map((r) => ({
      bucketAt: r.bucketAt,
      revenue: Number(r.revenue ?? 0),
    })),
    salesCategoryRows: salesCategoryRows.map((r) => ({
      categoryName: r.categoryName,
      revenue: Number(r.revenue ?? 0),
      profit: Number(r.profit ?? 0),
      quantity: r.quantity,
    })),
    salesRankRows: salesRankRows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      categoryName: r.categoryName,
      totalRevenue: Number(r.totalRevenue ?? 0),
      totalProfit: Number(r.totalProfit ?? 0),
      quantity: r.quantity,
      image: r.image,
    })),
    costSummaryRow: {
      currentTotalCost: Number(costSummaryRows[0]?.currentTotalCost ?? 0),
      previousTotalCost: Number(costSummaryRows[0]?.previousTotalCost ?? 0),
    },
    costDailyRows: costDailyRows.map((r) => ({
      bucketAt: r.bucketAt,
      amount: Number(r.amount ?? 0),
    })),
    costBucketRows: costBucketRows.map((r) => ({
      category: r.category,
      amount: Number(r.amount ?? 0),
    })),
  };
}
