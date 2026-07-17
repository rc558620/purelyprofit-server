import { PrismaService } from '../../../prisma/prisma.service';
import {
  MAX_INACTIVE_VIP_COUNT,
  MAX_RECENT_ORDER_COUNT,
  RECENT_ORDER_MIN_COUNT,
  RECENT_ORDER_WINDOW_HOURS,
} from './dashboard-home.constants';
import {
  DASHBOARD_HOME_RECENT_ORDER_SELECT,
  type DailyRevenueRow,
  type InactiveVipRow,
  type RecentOrderRow,
} from './dashboard-home.types';

/**
 * Prisma $queryRaw 返回的 date_trunc 结果是字符串而非 Date 对象，
 * 需要统一转换为 Date 以便后续 .getTime() / .getFullYear() 等调用。
 */
export function normalizeRawBucketAt<T extends { bucketAt: Date | string }>(
  rows: T[],
): T[] {
  return rows.map((row) => ({
    ...row,
    bucketAt:
      row.bucketAt instanceof Date ? row.bucketAt : new Date(row.bucketAt),
  }));
}

/**
 * 加载近 N+1 天每日营收，用于检测连续下滑趋势。
 * 使用原始 SQL 以复用已有的 sale_order_items + sale_orders 聚合模式。
 */
export async function loadRecentDailyRevenue(
  prisma: PrismaService,
  storeId: number,
  rangeStart: number,
  now: number,
): Promise<DailyRevenueRow[]> {
  const rows = await prisma.$queryRaw<DailyRevenueRow[]>`
    SELECT
      date_trunc('day', so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${storeId}
      AND so.date >= ${new Date(rangeStart)}
      AND so.date <= ${new Date(now)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return normalizeRawBucketAt(rows);
}

/**
 * 加载最近订单，用于首页动态。
 * 优先取最近 2 小时内订单；若不足 RECENT_ORDER_MIN_COUNT 条，则补今日内最近订单，并去重。
 */
export async function loadRecentOrders(
  prisma: PrismaService,
  storeId: number,
  todayStart: number,
  now: number,
): Promise<RecentOrderRow[]> {
  const windowStart = now - RECENT_ORDER_WINDOW_HOURS * 60 * 60 * 1000;

  // 1) 优先查最近 2 小时内的订单
  const recentOrders = await prisma.saleOrder.findMany({
    where: {
      storeId,
      createdAt: {
        gte: new Date(windowStart),
        lte: new Date(now),
      },
    },
    select: DASHBOARD_HOME_RECENT_ORDER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_RECENT_ORDER_COUNT,
  });

  if (recentOrders.length >= RECENT_ORDER_MIN_COUNT) {
    return recentOrders;
  }

  // 2) 2 小时内不足，补今日内最近订单，去重
  const existingIds = new Set(recentOrders.map((o) => o.id));
  const remaining = MAX_RECENT_ORDER_COUNT - recentOrders.length;

  const todayOrders = await prisma.saleOrder.findMany({
    where: {
      storeId,
      createdAt: {
        gte: new Date(todayStart),
        lte: new Date(now),
      },
      id: { notIn: [...existingIds] },
    },
    select: DASHBOARD_HOME_RECENT_ORDER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: remaining,
  });

  // 合并后按 createdAt 倒序
  const merged = [...recentOrders, ...todayOrders];
  merged.sort((a, b) => {
    const aTs = a.createdAt.getTime();
    const bTs = b.createdAt.getTime();
    if (bTs !== aTs) return bTs - aTs;
    return b.id - a.id;
  });

  return merged;
}

/**
 * 查询高价值会员久未到店列表（用于首页 dashboard 动态）
 *
 * level 和 lastConsumeAt 已从 Member 表删除，改从 MarketingCustomer 读取：
 * - level：由 mc.tier 映射（diamond→annual, gold→quarterly）
 * - lastConsumeAt：来自 mc.last_visit_at
 *
 * 高价值会员等级对应 MarketingCustomer.tier：
 * - annual → diamond
 * - quarterly → gold
 */
export async function loadInactiveVips(
  prisma: PrismaService,
  storeId: number,
  vipInactiveThreshold: Date,
): Promise<InactiveVipRow[]> {
  return prisma.$queryRaw<InactiveVipRow[]>`
    SELECT
      m.id,
      m.name,
      CASE mc.tier::text
        WHEN 'diamond' THEN 'annual'
        WHEN 'gold'    THEN 'quarterly'
        ELSE NULL
      END AS "level",
      mc.last_visit_at AS "lastConsumeAt",
      m.updated_at AS "updatedAt"
    FROM members m
    JOIN marketing_customers mc ON mc.id = m.customer_id
      AND mc.deleted_at IS NULL
    WHERE m.store_id = ${storeId}
      AND m.status = 'active'::"MemberStatus"
      AND m.deleted_at IS NULL
      AND mc.tier IN ('diamond', 'gold')
      AND (
        mc.last_visit_at IS NULL
        OR mc.last_visit_at < ${vipInactiveThreshold}
      )
    ORDER BY mc.last_visit_at ASC NULLS FIRST, m.updated_at DESC
    LIMIT ${MAX_INACTIVE_VIP_COUNT}
  `;
}
