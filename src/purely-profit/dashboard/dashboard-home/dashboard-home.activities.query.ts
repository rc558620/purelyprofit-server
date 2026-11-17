import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  getShanghaiDayEndMs,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import {
  DAY_MS,
  MAX_INACTIVE_VIP_COUNT,
  MAX_RECENT_ORDER_COUNT,
  MAX_TODAY_RECHARGE_COUNT,
  RECENT_ORDER_MIN_COUNT,
  RECENT_ORDER_WINDOW_HOURS,
  REVENUE_DECLINE_CONSECUTIVE_DAYS,
  UPCOMING_RESERVATION_WITHIN_HOURS,
  VIP_INACTIVE_THRESHOLD_DAYS,
} from './dashboard-home.constants';
import {
  DASHBOARD_HOME_RECENT_ORDER_SELECT,
  DASHBOARD_HOME_TODAY_RECHARGE_SELECT,
  DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT,
  type DailyRevenueRow,
  type DashboardHomeActivitiesLiveChunk,
  type InactiveVipRow,
  type LoadDashboardHomeActivitiesDataParams,
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
      -- 补齐明细侧门店条件，命中 (store_id, order_id) 部分索引
      AND soi.store_id = ${storeId}
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
 * 优先展示最近 2 小时内订单；不足 RECENT_ORDER_MIN_COUNT 条时，补今日内更早的订单。
 *
 * 两个窗口取并集一次查完：2 小时窗口是 [windowStart, now]，今日窗口是
 * [todayStart, now]，取下界较小者即可覆盖两者。结果天然按 createdAt/id 倒序且
 * 无重复，省掉「先查 2 小时、不够再串行补查今日」的第二次往返与 JS 去重排序。
 */
export async function loadRecentOrders(
  prisma: PrismaService,
  storeId: number,
  todayStart: number,
  now: number,
): Promise<RecentOrderRow[]> {
  const windowStart = now - RECENT_ORDER_WINDOW_HOURS * 60 * 60 * 1000;
  const rows = await prisma.saleOrder.findMany({
    where: {
      storeId,
      createdAt: {
        gte: new Date(Math.min(windowStart, todayStart)),
        lte: new Date(now),
      },
    },
    select: DASHBOARD_HOME_RECENT_ORDER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_RECENT_ORDER_COUNT,
  });

  // 倒序结果里 2 小时内的订单必然排在最前面，数出条数即可还原原分支语义：
  // 够数时只展示这段时间的动态，不够时保留补齐后的整页。
  let recentCount = 0;
  for (const row of rows) {
    if (row.createdAt.getTime() < windowStart) {
      break;
    }
    recentCount += 1;
  }

  return recentCount >= RECENT_ORDER_MIN_COUNT
    ? rows.slice(0, recentCount)
    : rows;
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

/**
 * 动态流两块查询共用的时间窗口。
 *
 * 集中计算是为了避免分块后两块各算一套「今天零点 / 三天后 / 回溯起点」，
 * 一旦某处口径改动而另一处漏改，就会出现「今日营收」与「今日会员」跨天的错位。
 */
export interface DashboardHomeActivitiesTimeWindows {
  todayStart: number;
  todayEnd: number;
  upcomingLeaveEnd: number;
  reservationWindowEnd: number;
  vipInactiveThreshold: Date;
  revenueLookbackStart: number;
}

export function resolveActivitiesTimeWindows(
  now: number,
): DashboardHomeActivitiesTimeWindows {
  const todayStart = getShanghaiDayStartMs(now);

  return {
    todayStart,
    todayEnd: getShanghaiDayEndMs(now),
    // 请假提醒覆盖「今天起 3 天内」
    upcomingLeaveEnd: getShanghaiDayEndMs(todayStart + DAY_MS * 3),
    reservationWindowEnd:
      now + UPCOMING_RESERVATION_WITHIN_HOURS * 60 * 60 * 1000,
    vipInactiveThreshold: new Date(now - VIP_INACTIVE_THRESHOLD_DAYS * DAY_MS),
    revenueLookbackStart: getShanghaiDayStartMs(
      now - (REVENUE_DECLINE_CONSECUTIVE_DAYS + 1) * DAY_MS,
    ),
  };
}

/**
 * 实时块：带「今天」语义、商家一两分钟内就能感知的数据，用短 TTL 独立缓存。
 *
 * 与状态块分开缓存，是为了让「今日充值 / 最近订单」这类强时效数据保持 45s
 * 刷新，而不必把库存、账款、促销等分钟级数据一起重算。
 */
export async function loadDashboardHomeActivitiesLiveChunk(
  prisma: PrismaService,
  params: LoadDashboardHomeActivitiesDataParams,
): Promise<DashboardHomeActivitiesLiveChunk> {
  const { storeId, now } = params;
  const { todayStart, todayEnd, reservationWindowEnd, revenueLookbackStart } =
    resolveActivitiesTimeWindows(now);

  const [
    todayNewMemberCount,
    todayRecharges,
    upcomingReservations,
    dailyRevenueRows,
    recentOrders,
  ] = await Promise.all([
    prisma.member.count({
      where: {
        storeId,
        createdAt: {
          gte: new Date(todayStart),
          lte: new Date(todayEnd),
        },
      },
    }),
    prisma.memberRechargeLog.findMany({
      where: {
        storeId,
        createdAt: {
          gte: new Date(todayStart),
          lte: new Date(todayEnd),
        },
      },
      select: DASHBOARD_HOME_TODAY_RECHARGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_TODAY_RECHARGE_COUNT,
    }),
    prisma.spaceReservation.findMany({
      where: {
        storeId,
        status: PrismaSpaceReservationStatus.pending,
        reservedAt: {
          gte: new Date(now),
          lte: new Date(reservationWindowEnd),
        },
      },
      select: DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT,
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
      take: 3,
    }),
    loadRecentDailyRevenue(prisma, storeId, revenueLookbackStart, now),
    loadRecentOrders(prisma, storeId, todayStart, now),
  ]);

  return {
    todayNewMemberCount,
    todayRecharges,
    upcomingReservations,
    dailyRevenueRows,
    recentOrders,
  };
}
