import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
} from '../../shared/shanghai-time.utils';
import { MEMBER_ONLINE_WINDOW_MS } from '../membership/membership.constants';
import { ONLINE_TREND_HOURS } from './dashboard.constants';
import type { HomeRevenueRange } from './dashboard-home.revenue.utils';
import { DAY_MS, HOUR_MS } from './dashboard-time.utils';
import type {
  DashboardPartnerTopRow,
  DashboardRevenueOrderRow,
  DashboardRevenueTypeCountRow,
} from './dashboard.types';

/** ILIKE 通配符转义：避免筛选值里的 % / _ 被当成通配符 */
const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * 合伙人地区筛选条件。
 *
 * 历史数据里 `store_partners.region` 既可能存地区名称（['广东省','深圳市']），
 * 也可能存行政区划编码（['440000','440300']），两种存量共存。
 * 因此这里对「名称」和「编码」各生成一条匹配规则并用 OR 连接，
 * 再对整条 region 数组做匹配（覆盖省 / 市 / 区三级），
 * 保证不论库里存的是哪种格式、筛的是哪一级，都能命中。
 */
function buildPartnerRegionCondition(
  region: string | undefined,
  regionCode: string | undefined,
): Prisma.Sql {
  const nameFilter = region?.trim();
  const codeFilter = regionCode?.trim();

  if (!nameFilter && !codeFilter) {
    return Prisma.empty;
  }

  const regionText = Prisma.sql`COALESCE(array_to_string(lp.region, ','), '')`;
  const conditions: Prisma.Sql[] = [];

  if (nameFilter) {
    conditions.push(
      Prisma.sql`${regionText} ILIKE ${`%${escapeLikePattern(nameFilter)}%`} ESCAPE '\\'`,
    );
  }

  if (codeFilter) {
    conditions.push(
      Prisma.sql`${regionText} LIKE ${`%${escapeLikePattern(codeFilter)}%`} ESCAPE '\\'`,
    );
  }

  return Prisma.sql`AND (${Prisma.join(conditions, ' OR ')})`;
}

/**
 * 查询合伙人推广排行 TOP5。
 *
 * 执行计划说明：
 * - CTE latest_partners: DISTINCT ON (store_id) 走 (store_id, reviewed_at) 索引
 * - 主查询 JOIN store_membership_promo_records 走 (store_id, has_charged) 索引
 * - 结果集小（LIMIT 5），聚合在 CTE 过滤后执行，性能可接受
 * - 地区条件走 array_to_string + ILIKE，无法走索引，但仅过滤少量 CTE 行，影响可忽略
 * - 地区同时按「名称 OR 编码」匹配，兼容 region 存名称与存编码两种历史数据
 */
export function queryPartnerTop(
  prisma: PrismaService,
  region: string | undefined,
  regionCode: string | undefined = undefined,
): Promise<DashboardPartnerTopRow[]> {
  const regionCondition = buildPartnerRegionCondition(region, regionCode);

  return prisma.$queryRaw<DashboardPartnerTopRow[]>`
    WITH latest_partners AS (
      SELECT DISTINCT ON (sp.store_id)
        sp.store_id AS "storeId",
        sp.name,
        sp.region
      FROM store_partners sp
      WHERE sp.status = 'approved'::"PartnerAccountStatus"
        AND sp.deleted_at IS NULL
      ORDER BY
        sp.store_id,
        sp.reviewed_at DESC NULLS LAST,
        sp.joined_at DESC NULLS LAST,
        sp.id DESC
    )
    SELECT
      lp.name,
      lp.region,
      COUNT(pr.id)::int AS orders,
      COALESCE(SUM(pr.charged_amount), 0)::int AS revenue
    FROM latest_partners lp
    JOIN store_membership_promo_records pr
      ON pr.store_id = lp."storeId"
     AND pr.has_charged = true
    WHERE lp.name IS NOT NULL
    ${regionCondition}
    GROUP BY lp.name, lp.region
    ORDER BY revenue DESC, orders DESC, lp.name ASC
    LIMIT 5
  `;
}

/** 在线统计的原始数据：实时在线数 + 窗口内活跃时间戳列表（ms） */
export interface PulseHomeOnlineRawData {
  onlineCount: number;
  activeAtMsList: number[];
}

/**
 * 读取在线统计所需的原始数据。
 *
 * 数据源：`users.last_active_at` —— 鉴权链路在每次请求时异步写入（5 分钟节流），
 * 因此它是「账号最近一次访问后端」的权威时间。
 *
 * 趋势窗口与「环比」所需窗口取并集，一次查询覆盖两项统计。
 */
export async function queryOnlineActivity(
  prisma: PrismaService,
  now: Date,
): Promise<PulseHomeOnlineRawData> {
  const nowMs = now.getTime();
  const yesterdayStartMs = getShanghaiDayStartMs(nowMs) - DAY_MS;
  const trendStartMs = nowMs - ONLINE_TREND_HOURS * HOUR_MS;

  const [onlineCount, activeUsers] = await Promise.all([
    prisma.user.count({
      where: {
        lastActiveAt: { gt: new Date(nowMs - MEMBER_ONLINE_WINDOW_MS) },
      },
    }),
    prisma.user.findMany({
      where: {
        lastActiveAt: {
          gte: new Date(Math.min(trendStartMs, yesterdayStartMs)),
        },
      },
      select: { lastActiveAt: true },
    }),
  ]);

  return {
    onlineCount,
    activeAtMsList: activeUsers
      .map((row) => row.lastActiveAt?.getTime())
      .filter((value): value is number => typeof value === 'number'),
  };
}

/** 推广充值汇总：全平台累计单数与累计充值金额（分） */
export interface PulseHomePromoSummary {
  totalOrders: number;
  totalChargedCents: number;
}

/** 首页原始数据：一次并发查询拿齐所有卡片所需的底层数据 */
export interface PulseHomeRawData {
  totalPartners: number;
  activePartnerCount: number;
  pendingApplicationCount: number;
  newThisMonthPartners: number;
  membershipOrders: DashboardRevenueOrderRow[];
  partnerTopRows: DashboardPartnerTopRow[];
  promoSummary: PulseHomePromoSummary;
  revenueTypeCounts: DashboardRevenueTypeCountRow[];
  online: PulseHomeOnlineRawData;
}

export interface LoadPulseHomeRawDataParams {
  region: string | undefined;
  regionCode: string | undefined;
  revenueRange: HomeRevenueRange;
  now: Date;
}

export async function loadPulseHomeRawData(
  prisma: PrismaService,
  params: LoadPulseHomeRawDataParams,
): Promise<PulseHomeRawData> {
  const { region, regionCode, revenueRange, now } = params;
  const { currentRange, previousRange } = revenueRange;

  const [
    totalPartners,
    activePartnerCount,
    pendingApplicationCount,
    newThisMonthPartners,
    membershipOrders,
    partnerTopRows,
    promoRecordSummary,
    revenueTypeCounts,
    online,
  ] = await Promise.all([
    prisma.storePartner.count({
      where: { deletedAt: null, status: 'approved' },
    }),
    prisma.storePartner.count({
      where: {
        deletedAt: null,
        status: 'approved',
        store: {
          membershipPromoRecords: {
            some: { hasCharged: true },
          },
        },
      },
    }),
    prisma.storePartnerApplication.count({
      where: { status: 'pending' },
    }),
    prisma.storePartner.count({
      where: {
        deletedAt: null,
        status: 'approved',
        joinedAt: {
          gte: new Date(getShanghaiMonthStartMs(now.getTime())),
        },
      },
    }),
    prisma.storeMembershipOrder.findMany({
      where: {
        status: 'paid',
        createdAt: {
          gte: new Date(previousRange.start),
          lte: new Date(currentRange.end),
        },
      },
      select: {
        amount: true,
        planId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    queryPartnerTop(prisma, region, regionCode),
    prisma.storeMembershipPromoRecord.aggregate({
      where: { hasCharged: true },
      _count: { _all: true },
      _sum: { chargedAmount: true },
    }),
    prisma.storeMembershipOrder.groupBy({
      by: ['planId'],
      where: {
        status: 'paid',
        createdAt: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
      },
      _count: { _all: true },
    }),
    queryOnlineActivity(prisma, now),
  ]);

  return {
    totalPartners,
    activePartnerCount,
    pendingApplicationCount,
    newThisMonthPartners,
    membershipOrders,
    partnerTopRows,
    promoSummary: {
      totalOrders: promoRecordSummary._count._all,
      totalChargedCents: promoRecordSummary._sum.chargedAmount ?? 0,
    },
    revenueTypeCounts: revenueTypeCounts.map((row) => ({
      planId: row.planId,
      count: row._count._all,
    })),
    online,
  };
}
