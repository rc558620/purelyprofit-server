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
  buildRevenueTypeDistribution,
  mapRevenuePlanLabel,
  normalizeRegionValues,
} from './dashboard-revenue.utils';
import type {
  DashboardRevenueOrderRow,
  DashboardRevenueTypeLabelRow,
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

    const dashboardData = await Promise.all([
      this.prisma.storePartner.findMany({
        where: { status: 'approved' },
        select: {
          id: true,
          name: true,
          region: true,
          joinedAt: true,
          store: {
            select: {
              membershipPromoRecords: {
                where: { hasCharged: true },
                select: { chargedAmount: true },
              },
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
        where: { status: 'paid' },
        select: {
          amount: true,
          planId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.storeMembershipPromoRecord.findMany({
        where: { hasCharged: true },
        select: {
          inviteeName: true,
          chargedAmount: true,
          storeId: true,
          store: {
            select: {
              partners: {
                where: { status: 'approved' },
                orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
                take: 1,
                select: {
                  name: true,
                  region: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.storeMembershipOrder.count({
        where: { status: 'paid' },
      }),
    ]);
    const [
      approvedPartners,
      pendingApplicationCount,
      newThisMonthPartners,
      membershipOrders,
      promoRecords,
      paidMemberCount,
    ] = dashboardData;

    const totalPartners = approvedPartners.length;
    const totalOrders = promoRecords.length;
    const totalRevenue = promoRecords.reduce(
      (sum, record) => sum + (record.chargedAmount ?? 0),
      0,
    );
    const activeRate =
      totalPartners > 0
        ? Math.round(
            (approvedPartners.filter(
              (partner) => partner.store.membershipPromoRecords.length > 0,
            ).length /
              totalPartners) *
              100,
          )
        : 0;
    const avgPerPartner =
      totalPartners > 0 ? Math.round(totalRevenue / totalPartners) : 0;

    const partnerRevenueMap = new Map<
      string,
      { name: string; city: string; orders: number; revenue: number }
    >();

    for (const record of promoRecords) {
      const partner = record.store?.partners[0] ?? null;
      if (!partner?.name) {
        continue;
      }

      const regionValues = normalizeRegionValues(partner.region);
      const city = regionValues[1] ?? regionValues[0] ?? UNKNOWN_REGION_LABEL;
      const province = regionValues[0] ?? '';
      if (region && !city.includes(region) && !province.includes(region)) {
        continue;
      }

      const existing = partnerRevenueMap.get(partner.name) ?? {
        name: partner.name,
        city,
        orders: 0,
        revenue: 0,
      };
      existing.orders += 1;
      existing.revenue += record.chargedAmount ?? 0;
      partnerRevenueMap.set(partner.name, existing);
    }

    const partnerTop = Array.from(partnerRevenueMap.values())
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 5);

    const { revenueTrend, revenueSummary } = this.buildHomeRevenueTrend(
      membershipOrders,
      revenuePeriod,
      now,
    );
    const revenueTypeRows: DashboardRevenueTypeLabelRow[] =
      membershipOrders.map((order) => ({
        typeLabel: mapRevenuePlanLabel(order.planId),
      }));
    const revenueTypeBreakdown = buildRevenueTypeDistribution(revenueTypeRows);

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
}
