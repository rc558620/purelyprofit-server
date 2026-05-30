import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPulseDashboardHomeCacheKey } from '../../redis/cache-keys';
import { RedisService } from '../../redis/redis.service';
import {
  DEFAULT_HOME_REVENUE_PERIOD,
  ONLINE_CHANGE_RATIO,
  ONLINE_COUNT_RATIO,
  ONLINE_PEAK_RATIO,
  UNKNOWN_REGION_LABEL,
} from './dashboard.constants';
import { calculatePercentChange } from './dashboard-math.utils';
import {
  buildRevenueTrend,
  buildRevenueTypeDistributionFromPlanCounts,
  normalizeRegionValues,
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
  PulseDashboardRevenueSummaryDto,
  PulseDashboardRevenueTrendDto,
} from './dto/pulse-dashboard-response.dto';

const PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;

@Injectable()
export class PulseDashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getHome(
    _user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    const revenuePeriod = queryDto.revenuePeriod ?? DEFAULT_HOME_REVENUE_PERIOD;
    const region = queryDto.region;
    const cacheKey = buildPulseDashboardHomeCacheKey(revenuePeriod, region);
    const cachedResponse =
      await this.redisService.getJson<PulseDashboardHomeResponseDto>(cacheKey);
    if (cachedResponse !== null) {
      return cachedResponse;
    }

    const now = new Date();
    const revenueQueryRange = this.buildRevenueQueryRange(revenuePeriod, now);

    const dashboardData = await Promise.all([
      this.prisma.storePartner.count({
        where: { status: 'approved' },
      }),
      this.prisma.storePartner.count({
        where: {
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
          status: 'approved',
          joinedAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), 1),
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
      this.queryPartnerTop(region),
      this.prisma.storeMembershipPromoRecord.aggregate({
        where: { hasCharged: true },
        _count: { _all: true },
        _sum: { chargedAmount: true },
      }),
      this.prisma.storeMembershipOrder.count({
        where: { status: 'paid' },
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
      paidMemberCount,
      revenueTypeCounts,
    ] = dashboardData;

    const totalOrders = promoRecordSummary._count._all;
    const totalRevenue = promoRecordSummary._sum.chargedAmount ?? 0;
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
        revenue: partner.revenue,
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

    const onlineCount = Math.round(paidMemberCount * ONLINE_COUNT_RATIO);
    const onlinePeak = Math.round(paidMemberCount * ONLINE_PEAK_RATIO);
    const onlineChangeRatio = ONLINE_CHANGE_RATIO;
    const onlineTrend = Array.from({ length: 10 }, (_, index) => {
      const ratio = 0.7 + Math.sin(index * 0.8) * 0.3;
      return Math.max(0, Math.round(onlineCount * ratio));
    });

    const response: PulseDashboardHomeResponseDto = {
      online: {
        onlineCount,
        onlinePeak,
        onlineChangeRatio,
        onlineTrend,
      },
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

    await this.redisService.setJson(
      cacheKey,
      response,
      PULSE_DASHBOARD_HOME_CACHE_TTL_SECONDS,
    );

    return response;
  }

  private async queryPartnerTop(
    region: string | undefined,
  ): Promise<DashboardPartnerTopRow[]> {
    const regionFilter = region?.trim();
    const regionCondition = regionFilter
      ? Prisma.sql`
          AND (
            COALESCE(lp.region[1], '') ILIKE ${`%${regionFilter}%`}
            OR COALESCE(lp.region[2], lp.region[1], '') ILIKE ${`%${regionFilter}%`}
          )
        `
      : Prisma.empty;

    return this.prisma.$queryRaw<DashboardPartnerTopRow[]>`
      WITH latest_partners AS (
        SELECT DISTINCT ON (sp.store_id)
          sp.store_id AS "storeId",
          sp.name,
          sp.region
        FROM store_partners sp
        WHERE sp.status = 'approved'::"PartnerAccountStatus"
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
    const previousRange = buildPreviousSequentialRange(currentRange);
    const periodOrders = orders.filter((order) =>
      isTimeInRange(order.createdAt, currentRange),
    );
    const previousTotal = orders
      .filter((order) => isTimeInRange(order.createdAt, previousRange))
      .reduce((sum, order) => sum + order.amount, 0);
    const total = periodOrders.reduce((sum, order) => sum + order.amount, 0);

    return {
      revenueTrend: buildRevenueTrend(periodOrders, period),
      revenueSummary: {
        total,
        avg: Math.round(total / getInclusiveDayCount(currentRange)),
        growth:
          calculatePercentChange(total, previousTotal, { fallback: 0 }) ?? 0,
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
    const previousRange = buildPreviousSequentialRange(currentRange);

    return {
      currentRange,
      previousRange,
    };
  }
}
