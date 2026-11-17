import { Prisma } from '@prisma/client';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import type { PrismaService } from '../../../prisma/prisma.service';
import { DAY_MS } from './dashboard-home.constants';
import type {
  DashboardHomeActivitiesData,
  DashboardHomeActivitiesLiveChunk,
  DashboardHomeActivitiesStableChunk,
  DashboardHomePeriodValue,
  TimeRange,
} from './dashboard-home.types';

/**
 * 把动态流两个缓存块拼回完整结构。
 *
 * 用展开合并而不是逐字段赋值：`StableChunk` 是 `Omit<Data, LiveKeys>`，
 * 两块并集必须覆盖 `DashboardHomeActivitiesData` 的全部字段，否则编译报错，
 * 将来加字段时不会出现「缓存块少一个字段但运行时静默 undefined」。
 */
export function mergeDashboardHomeActivitiesChunks(
  stable: DashboardHomeActivitiesStableChunk,
  live: DashboardHomeActivitiesLiveChunk,
): DashboardHomeActivitiesData {
  return { ...stable, ...live };
}

/** 趋势图起算点：周视图从锚点日往前补足 7 天，其余沿用当期起点 */
export function resolveTrendStart(
  period: DashboardHomePeriodValue,
  currentRange: TimeRange,
): number {
  if (period === 'week') {
    const anchorDayStart = getShanghaiDayStartMs(currentRange.end);
    return anchorDayStart - DAY_MS * 6;
  }

  return currentRange.start;
}

/** 趋势 SQL 的时间粒度 */
export function resolveTrendSqlGranularity(
  period: DashboardHomePeriodValue,
): 'hour' | 'day' | 'month' {
  if (period === 'today') {
    return 'hour';
  }

  if (period === 'year' || period === 'last_year') {
    return 'month';
  }

  return 'day';
}

interface DashboardHomeSalesCompareRow {
  current_revenue: Prisma.Decimal | null;
  current_profit: Prisma.Decimal | null;
  current_order_count: bigint;
  compare_revenue: Prisma.Decimal | null;
  compare_profit: Prisma.Decimal | null;
  compare_order_count: bigint;
}

/**
 * 当期与对比期的销售汇总共用一次 sale_order_items 扫描。
 *
 * 原先两条 SELECT 完全相同、仅时间范围不同的 SQL 各扫一遍大表；这里把 WHERE
 * 放宽到两期并集，再用 CASE / FILTER 分别还原各自的聚合。两个范围条件彼此独立，
 * 所以即使将来两期出现重叠，结果仍与两次独立查询一致；抵扣行的排除条件不变。
 */
export async function loadDashboardHomeSalesCompare(
  prisma: PrismaService,
  storeId: number,
  currentRange: TimeRange,
  compareRange: TimeRange,
): Promise<DashboardHomeSalesCompareRow | undefined> {
  const queryRange: TimeRange = {
    start: Math.min(currentRange.start, compareRange.start),
    end: Math.max(currentRange.end, compareRange.end),
  };
  const currentStart = new Date(currentRange.start);
  const currentEnd = new Date(currentRange.end);
  const compareStart = new Date(compareRange.start);
  const compareEnd = new Date(compareRange.end);

  const rows = await prisma.$queryRaw<DashboardHomeSalesCompareRow[]>`
    SELECT
      COALESCE(SUM(
        CASE WHEN so.date >= ${currentStart} AND so.date <= ${currentEnd}
        THEN soi.sale_price * soi.quantity ELSE 0 END
      ), 0) AS current_revenue,
      COALESCE(SUM(
        CASE WHEN so.date >= ${currentStart} AND so.date <= ${currentEnd}
        THEN soi.profit * soi.quantity ELSE 0 END
      ), 0) AS current_profit,
      COUNT(DISTINCT so.id) FILTER (
        WHERE so.date >= ${currentStart} AND so.date <= ${currentEnd}
      ) AS current_order_count,
      COALESCE(SUM(
        CASE WHEN so.date >= ${compareStart} AND so.date <= ${compareEnd}
        THEN soi.sale_price * soi.quantity ELSE 0 END
      ), 0) AS compare_revenue,
      COALESCE(SUM(
        CASE WHEN so.date >= ${compareStart} AND so.date <= ${compareEnd}
        THEN soi.profit * soi.quantity ELSE 0 END
      ), 0) AS compare_profit,
      COUNT(DISTINCT so.id) FILTER (
        WHERE so.date >= ${compareStart} AND so.date <= ${compareEnd}
      ) AS compare_order_count
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${storeId}
      -- 明细的 store_id 与订单主体一致（写入口径保证），显式带上后
      -- 才能命中 sale_order_items 的部分索引 (store_id, order_id)，
      -- 避免多租户下从明细侧全表扫描后再回表过滤门店。
      AND soi.store_id = ${storeId}
      AND so.date >= ${new Date(queryRange.start)}
      AND so.date <= ${new Date(queryRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
  `;

  return rows[0];
}

interface DashboardHomeCostsCompareRow {
  current_cost: number | bigint;
  compare_cost: number | bigint;
}

/**
 * 当期与对比期的成本汇总共用一次 cost_records 扫描。
 *
 * 与销售汇总同理：两次 aggregate 的 WHERE 只差时间范围，合并成一次条件为
 * 两期并集的查询，再用 CASE 还原各自金额。代价是扫描范围取并集（通常相邻两期，
 * 增量很小），收益是少一次往返、少一遍成本表扫描。
 */
export async function loadDashboardHomeCostsCompare(
  prisma: PrismaService,
  storeId: number,
  currentRange: TimeRange,
  compareRange: TimeRange,
): Promise<DashboardHomeCostsCompareRow | undefined> {
  const queryRange: TimeRange = {
    start: Math.min(currentRange.start, compareRange.start),
    end: Math.max(currentRange.end, compareRange.end),
  };
  const currentStart = new Date(currentRange.start);
  const currentEnd = new Date(currentRange.end);
  const compareStart = new Date(compareRange.start);
  const compareEnd = new Date(compareRange.end);

  const rows = await prisma.$queryRaw<DashboardHomeCostsCompareRow[]>`
    SELECT
      COALESCE(SUM(
        CASE WHEN cr.date >= ${currentStart} AND cr.date <= ${currentEnd}
        THEN cr.amount ELSE 0 END
      ), 0) AS current_cost,
      COALESCE(SUM(
        CASE WHEN cr.date >= ${compareStart} AND cr.date <= ${compareEnd}
        THEN cr.amount ELSE 0 END
      ), 0) AS compare_cost
    FROM cost_records cr
    WHERE cr.store_id = ${storeId}
      AND cr.date >= ${new Date(queryRange.start)}
      AND cr.date <= ${new Date(queryRange.end)}
  `;

  return rows[0];
}
