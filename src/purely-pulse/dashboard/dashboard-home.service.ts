import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildPulseDashboardHomeCacheKey } from '../pulse.cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  DEFAULT_HOME_REVENUE_PERIOD,
  ONLINE_TREND_HOURS,
  UNKNOWN_REGION_LABEL,
} from './dashboard.constants';
import { MEMBER_ONLINE_WINDOW_MS } from '../membership/membership.constants';
import { calculatePercentChange } from './dashboard-math.utils';
import { Money } from '../../shared/money.utils';
import {
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
} from '../../shared/shanghai-time.utils';
import {
  buildRevenueTrend,
  buildRevenueTypeDistributionFromPlanCounts,
  normalizeRegionValues,
  toRevenueAmountDisplay,
} from './dashboard-revenue.utils';
import type {
  DashboardPartnerTopRow,
  DashboardRevenueOrderRow,
  DashboardRevenueTypeCountRow,
} from './dashboard.types';
import {
  buildHomeRevenueRange,
  buildPreviousSequentialRange,
  getInclusiveDayCount,
  isTimeInRange,
} from './dashboard-time.utils';
import type {
  GetPulseDashboardHomeQueryDto,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardHomeResponseDto,
  PulseDashboardOnlineStatsDto,
  PulseDashboardRevenueSummaryDto,
  PulseDashboardRevenueTrendDto,
} from './dto/pulse-dashboard-home.response.dto';

const PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS = 10_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

@Injectable()
export class PulseDashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getHome(
    _user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    const revenuePeriod = queryDto.revenuePeriod ?? DEFAULT_HOME_REVENUE_PERIOD;
    const region = queryDto.region;
    const regionCode = queryDto.regionCode;
    const cacheKey = buildPulseDashboardHomeCacheKey(
      revenuePeriod,
      region,
      regionCode,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_DASHBOARD_HOME_REFRESH_AFTER_MS,
      loadValue: () => this.buildHome(revenuePeriod, region, regionCode),
    });
  }

  /**
   * 在线 / 活跃统计（真实数据，非模拟值）。
   *
   * 数据源：`users.last_active_at` —— 鉴权链路在每次请求时异步写入（5 分钟节流），
   * 因此它是「账号最近一次访问后端」的权威时间。
   *
   * 口径：
   * - `onlineCount`：最近 {@link MEMBER_ONLINE_WINDOW_MS}（10 分钟）内有鉴权请求的账号数（实时在线）
   * - `onlinePeak`：今日各小时「活跃人数」的最大值（未做秒级采样，按小时粒度统计）
   * - `onlineTrend`：最近 {@link ONLINE_TREND_HOURS} 个小时的活跃人数（sparkline）
   * - `onlineChangeRatio`：今日活跃人数较昨日的百分比变化（自然日按上海时区切分）
   */
  private async loadOnlineStats(
    now: Date,
  ): Promise<PulseDashboardOnlineStatsDto> {
    const nowMs = now.getTime();
    const todayStartMs = getShanghaiDayStartMs(nowMs);
    const yesterdayStartMs = todayStartMs - DAY_MS;
    const trendStartMs = nowMs - ONLINE_TREND_HOURS * HOUR_MS;

    const [onlineCount, activeUsers] = await Promise.all([
      this.prisma.user.count({
        where: {
          lastActiveAt: { gt: new Date(nowMs - MEMBER_ONLINE_WINDOW_MS) },
        },
      }),
      this.prisma.user.findMany({
        // 趋势窗口与「环比」所需窗口取并集，一次查询覆盖两项统计
        where: {
          lastActiveAt: {
            gte: new Date(Math.min(trendStartMs, yesterdayStartMs)),
          },
        },
        select: { lastActiveAt: true },
      }),
    ]);

    const activeAtMsList = activeUsers
      .map((row) => row.lastActiveAt?.getTime())
      .filter((value): value is number => typeof value === 'number');

    const todayActiveCount = activeAtMsList.filter(
      (value) => value >= todayStartMs,
    ).length;
    const yesterdayActiveCount = activeAtMsList.filter(
      (value) => value >= yesterdayStartMs && value < todayStartMs,
    ).length;

    // 今日各小时桶（上海时区自然日）→ 取最大值作为「今日峰值」
    const elapsedTodayHours = Math.min(
      Math.floor((nowMs - todayStartMs) / HOUR_MS) + 1,
      24,
    );
    const todayHourBuckets = new Array<number>(elapsedTodayHours).fill(0);
    for (const activeAtMs of activeAtMsList) {
      if (activeAtMs < todayStartMs) {
        continue;
      }

      const bucketIndex = Math.floor((activeAtMs - todayStartMs) / HOUR_MS);
      if (bucketIndex >= 0 && bucketIndex < elapsedTodayHours) {
        todayHourBuckets[bucketIndex] += 1;
      }
    }

    const onlineTrend = Array.from(
      { length: ONLINE_TREND_HOURS },
      (_, index) => {
        const bucketStartMs = trendStartMs + index * HOUR_MS;
        return activeAtMsList.filter(
          (value) => value >= bucketStartMs && value < bucketStartMs + HOUR_MS,
        ).length;
      },
    );

    return {
      onlineCount,
      onlinePeak: todayHourBuckets.reduce(
        (max, count) => (count > max ? count : max),
        0,
      ),
      onlineChangeRatio:
        calculatePercentChange(todayActiveCount, yesterdayActiveCount, {
          fallback: 0,
        }) ?? 0,
      onlineTrend,
    };
  }

  private async buildHome(
    revenuePeriod: PulseHomeRevenuePeriodValue,
    region: string | undefined,
    regionCode: string | undefined = undefined,
  ): Promise<PulseDashboardHomeResponseDto> {
    const now = new Date();
    const revenueQueryRange = this.buildRevenueQueryRange(revenuePeriod, now);

    const dashboardData = await Promise.all([
      this.prisma.storePartner.count({
        where: { deletedAt: null, status: 'approved' },
      }),
      this.prisma.storePartner.count({
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
      this.prisma.storePartnerApplication.count({
        where: { status: 'pending' },
      }),
      this.prisma.storePartner.count({
        where: {
          deletedAt: null,
          status: 'approved',
          joinedAt: {
            gte: new Date(getShanghaiMonthStartMs(now.getTime())),
          },
        },
      }),
      this.prisma.storeMembershipOrder.findMany({
        where: {
          status: 'paid',
          createdAt: {
            gte: new Date(revenueQueryRange.previousRange.start),
            lte: new Date(revenueQueryRange.currentRange.end),
          },
        },
        select: {
          amount: true,
          planId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.queryPartnerTop(region, regionCode),
      this.prisma.storeMembershipPromoRecord.aggregate({
        where: { hasCharged: true },
        _count: { _all: true },
        _sum: { chargedAmount: true },
      }),
      this.prisma.storeMembershipOrder.groupBy({
        by: ['planId'],
        where: {
          status: 'paid',
          createdAt: {
            gte: new Date(revenueQueryRange.currentRange.start),
            lte: new Date(revenueQueryRange.currentRange.end),
          },
        },
        _count: { _all: true },
      }),
    ]);
    const [
      totalPartners,
      activePartnerCount,
      pendingApplicationCount,
      newThisMonthPartners,
      membershipOrders,
      partnerTopRows,
      promoRecordSummary,
      revenueTypeCounts,
    ] = dashboardData;

    const totalOrders = promoRecordSummary._count._all;
    const totalRevenue = Money.fromDbCents(
      promoRecordSummary._sum.chargedAmount ?? 0,
    ).toOutputYuan();
    const activeRate =
      totalPartners > 0
        ? Math.round((activePartnerCount / totalPartners) * 100)
        : 0;
    const avgPerPartner =
      totalPartners > 0 ? Math.round(totalRevenue / totalPartners) : 0;

    const partnerTop = partnerTopRows.map((partner) => {
      const regionValues = normalizeRegionValues(partner.region);
      return {
        name: partner.name,
        city: regionValues[1] ?? regionValues[0] ?? UNKNOWN_REGION_LABEL,
        orders: partner.orders,
        revenue: Money.fromDbCents(partner.revenue).toOutputYuan(),
      };
    });

    const { revenueTrend, revenueSummary } = this.buildHomeRevenueTrend(
      membershipOrders,
      revenuePeriod,
      now,
    );
    const revenueTypeBreakdown = buildRevenueTypeDistributionFromPlanCounts(
      revenueTypeCounts.map(
        (row): DashboardRevenueTypeCountRow => ({
          planId: row.planId,
          count: row._count._all,
        }),
      ),
    );

    const online = await this.loadOnlineStats(now);

    return {
      online,
      partnerStats: {
        total: totalPartners,
        newThisMonth: newThisMonthPartners,
        activeRate,
        totalRevenue,
        totalOrders,
        avgPerPartner,
      },
      partnerTop,
      revenueTrend,
      revenueSummary,
      revenueTypeBreakdown,
      pendingApplicationCount,
      generatedAt: Date.now(),
    };
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
  private async queryPartnerTop(
    region: string | undefined,
    regionCode: string | undefined = undefined,
  ): Promise<DashboardPartnerTopRow[]> {
    const regionCondition = buildPartnerRegionCondition(region, regionCode);

    return this.prisma.$queryRaw<DashboardPartnerTopRow[]>`
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

  private buildHomeRevenueTrend(
    orders: DashboardRevenueOrderRow[],
    period: PulseHomeRevenuePeriodValue,
    now: Date,
  ): {
    revenueTrend: PulseDashboardRevenueTrendDto;
    revenueSummary: PulseDashboardRevenueSummaryDto;
  } {
    const currentRange = buildHomeRevenueRange(period, now);
    const previousRange = buildPreviousSequentialRange(currentRange, period);
    const periodOrders = orders.filter((order) =>
      isTimeInRange(order.createdAt, currentRange),
    );
    const previousTotal = orders
      .filter((order) => isTimeInRange(order.createdAt, previousRange))
      .reduce((sum, order) => sum + order.amount, 0);
    const dayCount = getInclusiveDayCount(currentRange);
    const totalMoney = Money.sum(
      periodOrders.map((order) => Money.fromDbCents(order.amount)),
    );
    const total = totalMoney.toOutputYuan();

    return {
      revenueTrend: buildRevenueTrend(periodOrders, period, (amountFen) =>
        Money.fromDbCents(amountFen).toOutputYuan(),
      ),
      revenueSummary: {
        total,
        totalDisplay: toRevenueAmountDisplay(totalMoney.toDbCents()),
        avg: Math.round(total / dayCount),
        avgDisplay: toRevenueAmountDisplay(
          totalMoney.divide(dayCount).toDbCents(),
        ),
        growth:
          calculatePercentChange(totalMoney.toDbCents(), previousTotal, {
            fallback: 0,
          }) ?? 0,
      },
    };
  }

  private buildRevenueQueryRange(
    period: PulseHomeRevenuePeriodValue,
    now: Date,
  ): {
    currentRange: ReturnType<typeof buildHomeRevenueRange>;
    previousRange: ReturnType<typeof buildPreviousSequentialRange>;
  } {
    const currentRange = buildHomeRevenueRange(period, now);
    const previousRange = buildPreviousSequentialRange(currentRange, period);

    return {
      currentRange,
      previousRange,
    };
  }
}
