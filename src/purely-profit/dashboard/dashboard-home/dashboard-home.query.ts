import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeRawBucketAt } from './dashboard-home.activities.query';
import {
  DASHBOARD_HOME_STORE_SELECT,
  type DashboardHomeStatsData,
  type DashboardHomeTrendRevenueRow,
  type LoadDashboardHomeStatsDataParams,
  type LoadDashboardHomeTrendDataParams,
} from './dashboard-home.types';

import {
  loadDashboardHomeCostsCompare,
  loadDashboardHomeSalesCompare,
  resolveTrendSqlGranularity,
  resolveTrendStart,
} from './dashboard-home.query.helpers';

export async function loadDashboardHomeStatsData(
  prisma: PrismaService,
  params: LoadDashboardHomeStatsDataParams,
): Promise<DashboardHomeStatsData> {
  const { storeId, currentRange, compareRange } = params;
  const [store, salesRow, costsRow] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: DASHBOARD_HOME_STORE_SELECT,
    }),
    loadDashboardHomeSalesCompare(prisma, storeId, currentRange, compareRange),
    loadDashboardHomeCostsCompare(prisma, storeId, currentRange, compareRange),
  ]);

  return {
    store,
    currentSales: {
      revenue: Money.fromDbCents(
        Number(salesRow?.current_revenue ?? 0),
      ).toOutputYuan(),
      profit: Money.fromDbCents(
        Number(salesRow?.current_profit ?? 0),
      ).toOutputYuan(),
      orderCount: Number(salesRow?.current_order_count ?? 0),
    },
    compareSales: {
      revenue: Money.fromDbCents(
        Number(salesRow?.compare_revenue ?? 0),
      ).toOutputYuan(),
      profit: Money.fromDbCents(
        Number(salesRow?.compare_profit ?? 0),
      ).toOutputYuan(),
      orderCount: Number(salesRow?.compare_order_count ?? 0),
    },
    currentCosts: {
      totalCost: Money.fromDbCents(
        Number(costsRow?.current_cost ?? 0),
      ).toOutputYuan(),
    },
    compareCosts: {
      totalCost: Money.fromDbCents(
        Number(costsRow?.compare_cost ?? 0),
      ).toOutputYuan(),
    },
  };
}

export async function loadDashboardHomeTrendRows(
  prisma: PrismaService,
  params: LoadDashboardHomeTrendDataParams,
): Promise<DashboardHomeTrendRevenueRow[]> {
  const trendStart = resolveTrendStart(params.period, params.currentRange);
  const sqlGranularity = resolveTrendSqlGranularity(params.period);

  const rows = await prisma.$queryRaw<DashboardHomeTrendRevenueRow[]>`
    SELECT
      date_trunc(${sqlGranularity}, so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${params.storeId}
      -- 与销售汇总同理：补上明细侧 store_id 才能用上
      -- (store_id, order_id) 部分索引，年视图下避免跨门店扫描
      AND soi.store_id = ${params.storeId}
      AND so.date >= ${new Date(trendStart)}
      AND so.date <= ${new Date(params.currentRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return normalizeRawBucketAt(rows);
}
