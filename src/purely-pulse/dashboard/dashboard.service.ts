import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { BusinessAnalysisService } from '../../purely-profit/dashboard/business-analysis/business-analysis.service';
import type { GetBusinessAnalysisQueryDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  PulseStoreContextService,
  type PulseTargetStoreSummary,
} from '../pulse-store-context.service';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import {
  buildCompareRange,
  buildCurrentRange,
  formatDateLabel,
} from './dashboard-time.utils';
import type { TimeRange } from './dashboard-time.utils';
import type {
  GetPulseDashboardAnalysisQueryDto,
  GetPulseDashboardHomeQueryDto,
  GetPulseDashboardOverviewQueryDto,
  GetPulseDashboardStoresQueryDto,
  GetPulseRevenueDetailQueryDto,
  PulseDashboardPeriodValue,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardHomeResponseDto,
  PulseDashboardMetaDto,
  PulseDashboardOverviewResponseDto,
  PulseDashboardRevenueTypeItemDto,
  PulseDashboardSalesTrendDto,
  PulseDashboardStatsDto,
  PulseDashboardStoreRankItemDto,
  PulseDashboardStoresResponseDto,
  PulseRevenueDetailResponseDto,
} from './dto/pulse-dashboard-response.dto';

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

const TODAY_BUCKET_HOURS = [8, 10, 12, 14, 16, 18, 20, 22] as const;
const TODAY_BUCKET_LABELS = TODAY_BUCKET_HOURS.map(
  (h) => `${String(h).padStart(2, '0')}:00`,
);
const YEAR_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);
const PERIOD_ORDER_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日订单数',
  week: '本周订单数',
  month: '本月订单数',
  year: '今年订单数',
};
const PERIOD_PROFIT_LABEL: Record<PulseDashboardPeriodValue, string> = {
  today: '今日净利润 (元)',
  week: '本周净利润 (元)',
  month: '本月净利润 (元)',
  year: '今年净利润 (元)',
};
const DAY_MS = 24 * 60 * 60 * 1000;
const REVENUE_DETAIL_TYPE_LABELS = [
  '月卡会员',
  '季度会员',
  '年卡会员',
  '其他充值',
] as const;

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class PulseDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly aggregator: DashboardAggregatorService,
    private readonly businessAnalysisService: BusinessAnalysisService,
    private readonly pulseStoreContextService: PulseStoreContextService,
  ) {}

  // ──────────────────────────────────────────────
  // 跨店经营总览
  // ──────────────────────────────────────────────

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    const period = queryDto.period ?? 'today';
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看经营总览',
    );
    const storeIds = [targetStore.id];

    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);

    const [currentAgg, compareAgg, costSum, compareCostSum] = await Promise.all(
      [
        this.aggregator.aggregateSales(storeIds, currentRange),
        this.aggregator.aggregateSales(storeIds, compareRange),
        this.aggregator.aggregateCosts(storeIds, currentRange),
        this.aggregator.aggregateCosts(storeIds, compareRange),
      ],
    );

    const currentProfit = new Decimal(currentAgg.totalRevenue)
      .minus(costSum)
      .toNumber();
    const compareProfit = new Decimal(compareAgg.totalRevenue)
      .minus(compareCostSum)
      .toNumber();

    return {
      stats: this.buildStats(
        period,
        currentAgg,
        compareAgg,
        currentProfit,
        compareProfit,
        costSum,
      ),
      salesTrend: await this.buildSalesTrend(storeIds, period, currentRange),
      meta: this.buildMeta(period, targetStore.id, storeIds.length, currentRange),
    };
  }

  // ──────────────────────────────────────────────
  // 门店排行
  // ──────────────────────────────────────────────

  async getStores(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardStoresQueryDto,
  ): Promise<PulseDashboardStoresResponseDto> {
    const period = queryDto.period ?? 'month';
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看门店排行',
    );
    const storeIds = [targetStore.id];

    const currentRange = buildCurrentRange(period);

    const storeRows = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, address: true },
    });

    const [salesTotals, costTotals] = await Promise.all([
      this.aggregator.aggregateSalesByStore(storeIds, currentRange),
      this.aggregator.aggregateCostsByStore(storeIds, currentRange),
    ]);

    const storeRankItems: PulseDashboardStoreRankItemDto[] = storeRows.map(
      (store) => {
        const sales = salesTotals[store.id] ?? {
          totalRevenue: 0,
          totalProfit: 0,
          orderCount: 0,
        };
        const cost = costTotals[store.id] ?? 0;
        const profit = new Decimal(sales.totalRevenue).minus(cost).toNumber();
        const profitRate =
          sales.totalRevenue > 0
            ? new Decimal(profit)
                .div(sales.totalRevenue)
                .mul(100)
                .toDecimalPlaces(2)
                .toNumber()
            : 0;

        return {
          storeId: store.id,
          storeName: store.name,
          address: store.address,
          profit,
          revenue: sales.totalRevenue,
          totalCost: cost,
          orderCount: sales.orderCount,
          profitRate,
          rank: 0,
        };
      },
    );

    // 按净利润降序排列，赋 rank
    storeRankItems.sort((a, b) => b.profit - a.profit);
    storeRankItems.forEach((item, index) => {
      item.rank = index + 1;
    });

    return {
      meta: this.buildMeta(period, targetStore.id, storeIds.length, currentRange),
      stores: storeRankItems,
    };
  }

  // ──────────────────────────────────────────────
  // 代理：经营分析（BusinessAnalysis）
  // ──────────────────────────────────────────────

  async getAnalysis(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看经营分析',
    );

    const proxyQuery: GetBusinessAnalysisQueryDto = {
      period: queryDto.period ?? 'month',
      storeId: targetStore.id,
      startTime: queryDto.startTime,
      endTime: queryDto.endTime,
    };

    return this.businessAnalysisService.getAnalysisByStoreId(
      targetStore.id,
      proxyQuery,
    );
  }

  // ──────────────────────────────────────────────
  // Home 页聚合数据
  // ──────────────────────────────────────────────

  async getRevenueDetail(
    _user: AuthenticatedUser,
    queryDto: GetPulseRevenueDetailQueryDto,
  ): Promise<PulseRevenueDetailResponseDto> {
    const now = new Date();
    const { currentRange, previousRange, displayPeriod } =
      this.resolveRevenueDetailRanges(queryDto, now);
    const lowerBound = Math.min(previousRange.start, currentRange.start);
    const upperBound = Math.max(previousRange.end, currentRange.end);

    const rawOrders = await this.prisma.storeMembershipOrder.findMany({
      where: {
        status: 'paid',
        createdAt: {
          gte: new Date(lowerBound),
          lte: new Date(upperBound),
        },
      },
      select: {
        id: true,
        storeId: true,
        amount: true,
        planId: true,
        planName: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            address: true,
            owner: {
              select: {
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const regionFilters = this.extractRevenueRegionFilters(queryDto);
    const storeIds = Array.from(new Set(rawOrders.map((order) => order.storeId)));
    const regionCodeMap = await this.readRevenueRegionCodeMap(storeIds);
    const orders = rawOrders.filter((order) =>
      this.matchesRevenueRegion(regionCodeMap.get(order.storeId) ?? [], regionFilters),
    );

    const previousOrders = orders.filter((order) =>
      this.isTimeInRange(order.createdAt, previousRange),
    );
    const currentOrders = orders.filter((order) =>
      this.isTimeInRange(order.createdAt, currentRange),
    );
    const currentTotal = currentOrders.reduce((sum, order) => sum + order.amount, 0);
    const previousTotal = previousOrders.reduce((sum, order) => sum + order.amount, 0);
    const growth =
      previousTotal > 0
        ? new Decimal(currentTotal - previousTotal)
            .div(previousTotal)
            .mul(100)
            .toDecimalPlaces(1)
            .toNumber()
        : 0;

    return {
      revenueTrend: this.buildRevenueDetailTrend(currentOrders, displayPeriod),
      revenueSummary: {
        total: currentTotal,
        avg: Math.round(currentTotal / this.getInclusiveDayCount(currentRange)),
        growth,
        orders: currentOrders.length,
        peak: this.calcRevenuePeakFen(currentOrders),
      },
      revenueTypeBreakdown: this.buildRevenueDetailTypeDistribution(
        currentOrders.map((order) => ({
          typeLabel: this.mapRevenuePlanLabel(order.planId, order.planName),
        })),
      ),
      records: currentOrders
        .slice()
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((order) => ({
          id: String(order.id),
          user:
            order.store.owner.realName?.trim() ||
            order.store.owner.name?.trim() ||
            order.store.name,
          type: this.mapRevenuePlanLabel(order.planId, order.planName),
          amount: order.amount,
          region: this.buildRevenueRegionText(
            regionCodeMap.get(order.storeId) ?? [],
            order.store.address,
          ),
          time: this.formatRevenueTime(order.createdAt),
        })),
      totalRecords: currentOrders.length,
      generatedAt: now.getTime(),
    };
  }

  async getHome(
    _user: AuthenticatedUser,
    queryDto: GetPulseDashboardHomeQueryDto,
  ): Promise<PulseDashboardHomeResponseDto> {
    const revenuePeriod = queryDto.revenuePeriod ?? 'month';
    const region = queryDto.region;
    const now = new Date();

    // 并行查询所有所需数据
    const [
      approvedPartners,
      pendingApplicationCount,
      newThisMonthPartners,
      membershipOrders,
      promoRecords,
    ] = await Promise.all([
      // 已审核通过的合伙人列表（含 region 信息）
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
      // 待审核合伙人申请数
      this.prisma.storePartnerApplication.count({
        where: { status: 'pending' },
      }),
      // 本月新增合伙人数
      this.prisma.storePartner.count({
        where: {
          status: 'approved',
          joinedAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), 1),
          },
        },
      }),
      // 充值订单（用于收入趋势 + 类型分布）
      this.prisma.storeMembershipOrder.findMany({
        where: { status: 'paid' },
        select: {
          amount: true,
          planId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      // 推广记录（用于合伙人排行）
      this.prisma.storeMembershipPromoRecord.findMany({
        where: { hasCharged: true },
        select: {
          inviteeName: true,
          chargedAmount: true,
          storeId: true,
          store: {
            select: {
              partnerProfile: {
                select: {
                  name: true,
                  region: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // ── 合伙人快览统计 ────────────────────────────────────────
    const totalPartners = approvedPartners.length;
    const totalOrders = promoRecords.length;
    const totalRevenue = promoRecords.reduce(
      (sum, r) => sum + (r.chargedAmount ?? 0),
      0,
    );
    const activeRate =
      totalPartners > 0
        ? Math.round(
             (approvedPartners.filter(
               (p) =>
                 p.store.membershipPromoRecords.length > 0,
             ).length /
              totalPartners) *
              100,
          )
        : 0;
    const avgPerPartner =
      totalPartners > 0 ? Math.round(totalRevenue / totalPartners) : 0;

    // ── 合伙人排行 TOP5 ───────────────────────────────────────
    // 按合伙人聚合推广收益
    const partnerRevenueMap = new Map<
      string,
      { name: string; city: string; orders: number; revenue: number }
    >();

    for (const record of promoRecords) {
       const partner = record.store?.partnerProfile;
      if (!partner?.name) continue;

      // 地区筛选（取 region 数组中第二项作为城市）
      const city =
        (partner.region as string[])[1] ??
        (partner.region as string[])[0] ??
        '未知';

      if (region && !city.includes(region) && !((partner.region as string[])[0] ?? '').includes(region)) {
        continue;
      }

      const key = partner.name;
      const existing = partnerRevenueMap.get(key) ?? {
        name: partner.name,
        city,
        orders: 0,
        revenue: 0,
      };
      existing.orders += 1;
      existing.revenue += record.chargedAmount ?? 0;
      partnerRevenueMap.set(key, existing);
    }

    const partnerTop = Array.from(partnerRevenueMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ── 充值收入趋势 ──────────────────────────────────────────
    const { revenueTrend, revenueSummary } = this.buildHomRevenueTrend(
      membershipOrders,
      revenuePeriod,
      now,
    );

    // ── 充值类型分布 ──────────────────────────────────────────
    const revenueTypeBreakdown = this.buildRevenueTypeBreakdown(membershipOrders);

    // ── 在线人数（近似：使用平台付费会员数作为基准）─────────────
    const paidMemberCount = await this.prisma.storeMembershipOrder.count({
      where: { status: 'paid' },
    });
    // 近似在线：付费订单数的 5-15%（模拟实时，实际应对接 Redis/WebSocket）
    const onlineCount = Math.round(paidMemberCount * 0.08);
    const onlinePeak = Math.round(paidMemberCount * 0.15);
    const onlineChangeRatio = 12.0; // 实际应从昨日数据对比，此处返回默认占位值
    // 生成近 10 个时间点的模拟趋势（基于 onlineCount 上下浮动）
    const onlineTrend = Array.from({ length: 10 }, (_, i) => {
      const ratio = 0.7 + Math.sin(i * 0.8) * 0.3;
      return Math.max(0, Math.round(onlineCount * ratio));
    });

    return {
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
  }

  // ──────────────────────────────────────────────
  // 内部：构建充值收入趋势（Home 页）
  // ──────────────────────────────────────────────

  private buildHomRevenueTrend(
    orders: Array<{ amount: number; planId: string; createdAt: Date }>,
    period: PulseHomeRevenuePeriodValue,
    now: Date,
  ): {
    revenueTrend: { dates: string[]; values: number[] };
    revenueSummary: { total: number; avg: number; growth: number };
  } {
    const pad = (n: number) => String(n).padStart(2, '0');

    // 确定统计时间范围
    let startDate: Date;
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week': {
        const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        break;
      }
      case 'season': {
        const currentMonth = now.getMonth();
        const seasonStartMonth = Math.floor(currentMonth / 3) * 3;
        startDate = new Date(now.getFullYear(), seasonStartMonth, 1);
        break;
      }
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    // 过滤当期订单
    const periodOrders = orders.filter(
      (o) => o.createdAt >= startDate && o.createdAt <= now,
    );

    // 按时间粒度分桶
    const bucketMap = new Map<string, number>();

    for (const order of periodOrders) {
      let key: string;
      const d = order.createdAt;

      if (period === 'today') {
        // 按小时分桶
        key = `${d.getHours()}:00`;
      } else if (period === 'season') {
        // 按周分桶（显示 M/D 格式）
        const weekStart = new Date(d);
        const dow = weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1;
        weekStart.setDate(weekStart.getDate() - dow);
        key = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      } else {
        // week / month：按天分桶
        key = `${d.getMonth() + 1}/${d.getDate()}`;
      }

      bucketMap.set(key, (bucketMap.get(key) ?? 0) + order.amount);
    }

    const dates = Array.from(bucketMap.keys());
    const values = Array.from(bucketMap.values());

    // 汇总
    const total = periodOrders.reduce((s, o) => s + o.amount, 0);
    const days = Math.max(
      1,
      Math.ceil(
        (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const avg = Math.round(total / days);

    // 同期增长率（上期相同长度区间）
    const periodMs = now.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    const prevTotal = orders
      .filter((o) => o.createdAt >= prevStart && o.createdAt <= prevEnd)
      .reduce((s, o) => s + o.amount, 0);
    const growth =
      prevTotal > 0
        ? new Decimal(total - prevTotal)
            .div(prevTotal)
            .mul(100)
            .toDecimalPlaces(1)
            .toNumber()
        : 0;

    void pad; // suppress unused warning

    return {
      revenueTrend: { dates, values },
      revenueSummary: { total, avg, growth },
    };
  }

  // ──────────────────────────────────────────────
  // 内部：构建充值类型分布（Home 页）
  // ──────────────────────────────────────────────

  private buildRevenueTypeBreakdown(
    orders: Array<{ amount: number; planId: string; createdAt: Date }>,
  ): PulseDashboardRevenueTypeItemDto[] {
    const planLabelMap: Record<string, string> = {
      monthly: '月卡会员',
      quarterly: '季度会员',
      annual: '年卡会员',
    };

    const countMap = new Map<string, number>();
    let total = 0;

    for (const order of orders) {
      const label = planLabelMap[order.planId] ?? '其他充值';
      countMap.set(label, (countMap.get(label) ?? 0) + 1);
      total++;
    }

    if (total === 0) {
      return [
        { label: '月卡会员', value: 0 },
        { label: '季度会员', value: 0 },
        { label: '年卡会员', value: 0 },
        { label: '其他充值', value: 0 },
      ];
    }

    const allLabels = ['月卡会员', '季度会员', '年卡会员', '其他充值'];
    return allLabels.map((label) => ({
      label,
      value: Math.round(((countMap.get(label) ?? 0) / total) * 100),
    }));
  }

  private resolveRevenueDetailRanges(
    queryDto: GetPulseRevenueDetailQueryDto,
    now: Date,
  ): {
    currentRange: TimeRange;
    previousRange: TimeRange;
    displayPeriod: PulseHomeRevenuePeriodValue;
  } {
    if (queryDto.date) {
      const currentRange = this.buildSingleDayRange(queryDto.date);
      return {
        currentRange,
        previousRange: {
          start: currentRange.start - DAY_MS,
          end: currentRange.end - DAY_MS,
        },
        displayPeriod: 'today',
      };
    }

    if (queryDto.startDate && queryDto.endDate) {
      const currentRange = this.buildDateRange(
        queryDto.startDate,
        queryDto.endDate,
      );
      const rangeMs = currentRange.end - currentRange.start + 1;
      return {
        currentRange,
        previousRange: {
          start: currentRange.start - rangeMs,
          end: currentRange.start - 1,
        },
        displayPeriod: 'month',
      };
    }

    const displayPeriod = queryDto.period ?? 'month';
    let startDate: Date;
    switch (displayPeriod) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week': {
        startDate = new Date(now);
        const dayOfWeek = startDate.getDay() === 0 ? 6 : startDate.getDay() - 1;
        startDate.setDate(startDate.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        break;
      }
      case 'season': {
        const seasonStartMonth = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), seasonStartMonth, 1);
        break;
      }
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const currentRange = {
      start: startDate.getTime(),
      end: now.getTime(),
    };
    const rangeMs = currentRange.end - currentRange.start + 1;
    return {
      currentRange,
      previousRange: {
        start: currentRange.start - rangeMs,
        end: currentRange.start - 1,
      },
      displayPeriod,
    };
  }

  private buildSingleDayRange(dateText: string): TimeRange {
    const date = this.parseDateText(dateText);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999,
    );
    return {
      start: start.getTime(),
      end: end.getTime(),
    };
  }

  private buildDateRange(startText: string, endText: string): TimeRange {
    const startDate = this.parseDateText(startText);
    const endDate = this.parseDateText(endText);
    const rangeStart = new Date(
      Math.min(startDate.getTime(), endDate.getTime()),
    );
    const rangeEnd = new Date(
      Math.max(startDate.getTime(), endDate.getTime()),
    );
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);
    return {
      start: rangeStart.getTime(),
      end: rangeEnd.getTime(),
    };
  }

  private parseDateText(dateText: string): Date {
    const normalizedText = dateText.trim().replace(/\./g, '/').replace(/-/g, '/');
    const [yearText, monthText, dayText] = normalizedText.split('/');
    const year = Number.parseInt(yearText ?? '', 10);
    const month = Number.parseInt(monthText ?? '', 10);
    const day = Number.parseInt(dayText ?? '', 10);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      return new Date(dateText);
    }

    return new Date(year, month - 1, day);
  }

  private extractRevenueRegionFilters(
    queryDto: GetPulseRevenueDetailQueryDto,
  ): string[] {
    const filters = [
      queryDto.districtCode,
      queryDto.cityCode,
      queryDto.provinceCode,
      queryDto.regionCode,
      ...(queryDto.regionValues?.split(',') ?? []),
    ]
      .map((item) => item?.trim() ?? '')
      .filter(Boolean);

    return Array.from(new Set(filters));
  }

  private async readRevenueRegionCodeMap(
    storeIds: number[],
  ): Promise<Map<number, string[]>> {
    const entries = await Promise.all(
      storeIds.map(async (storeId) => {
        try {
          const raw = await this.redisService.get(`stores:profile:${storeId}`);
          if (!raw) {
            return [storeId, [] as string[]] as const;
          }

          const parsed = JSON.parse(raw) as {
            region?: unknown;
          };
          const regionCodes = Array.isArray(parsed.region)
            ? parsed.region
                .filter((item): item is string | number =>
                  typeof item === 'string' || typeof item === 'number',
                )
                .map((item) => String(item))
                .filter(Boolean)
            : [];

          return [storeId, regionCodes] as const;
        } catch {
          return [storeId, [] as string[]] as const;
        }
      }),
    );

    return new Map(entries);
  }

  private buildRevenueRegionText(
    regionCodes: string[],
    address: string | null,
  ): string {
    if (regionCodes.length > 0) {
      return regionCodes.join(' · ');
    }

    return address?.trim() || '--';
  }

  private matchesRevenueRegion(
    regionCodes: string[],
    filters: string[],
  ): boolean {
    if (filters.length === 0) {
      return true;
    }

    return filters.some((filter) => regionCodes.includes(filter));
  }

  private isTimeInRange(date: Date, range: TimeRange): boolean {
    const time = date.getTime();
    return time >= range.start && time <= range.end;
  }

  private getInclusiveDayCount(range: TimeRange): number {
    const start = new Date(range.start);
    const end = new Date(range.end);
    const startDay = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    ).getTime();
    const endDay = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
    ).getTime();
    return Math.max(1, Math.floor((endDay - startDay) / DAY_MS) + 1);
  }

  private toYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }

  private toFixedMoney(amount: number): number {
    return new Decimal(amount).toDecimalPlaces(2).toNumber();
  }

  private calcRevenuePeak(
    orders: Array<{ amount: number; createdAt: Date }>,
  ): number {
    const dailyTotals = new Map<string, number>();
    for (const order of orders) {
      const key = formatDateLabel(order.createdAt);
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + order.amount);
    }

    const maxAmountFen = Math.max(0, ...dailyTotals.values());
    return this.toYuan(maxAmountFen);
  }

  private buildRevenueDetailTrend(
    orders: Array<{ amount: number; createdAt: Date }>,
    displayPeriod: PulseHomeRevenuePeriodValue,
  ): { dates: string[]; values: number[] } {
    const bucketMap = new Map<string, number>();

    for (const order of orders) {
      let key: string;
      if (displayPeriod === 'today') {
        key = `${String(order.createdAt.getHours()).padStart(2, '0')}:00`;
      } else {
        key = formatDateLabel(order.createdAt);
      }
      bucketMap.set(key, (bucketMap.get(key) ?? 0) + order.amount);
    }

    const sortedEntries = Array.from(bucketMap.entries()).sort((a, b) => {
      const [aMonth, aDayOrHour] = a[0].split(/[:/]/).map((item) => Number(item));
      const [bMonth, bDayOrHour] = b[0].split(/[:/]/).map((item) => Number(item));
      return aMonth === bMonth ? aDayOrHour - bDayOrHour : aMonth - bMonth;
    });

    return {
      dates: sortedEntries.map(([date]) => date),
      values: sortedEntries.map(([, amountFen]) => this.toYuan(amountFen)),
    };
  }

  private buildRevenueDetailTypeDistribution(
    orders: Array<{ typeLabel: string }>,
  ): Array<{ label: string; value: number }> {
    if (orders.length === 0) {
      return REVENUE_DETAIL_TYPE_LABELS.map((label) => ({ label, value: 0 }));
    }

    const countMap = new Map<string, number>();
    for (const order of orders) {
      countMap.set(order.typeLabel, (countMap.get(order.typeLabel) ?? 0) + 1);
    }

    return REVENUE_DETAIL_TYPE_LABELS.map((label) => ({
      label,
      value: Math.round(((countMap.get(label) ?? 0) / orders.length) * 100),
    }));
  }

  private mapRevenuePlanLabel(planId: string, planName: string): string {
    if (planId === 'monthly') {
      return '月卡会员';
    }
    if (planId === 'quarterly') {
      return '季度会员';
    }
    if (planId === 'yearly' || planId === 'annual') {
      return '年卡会员';
    }

    if (planName.includes('月')) {
      return '月卡会员';
    }
    if (planName.includes('季')) {
      return '季度会员';
    }
    if (planName.includes('年')) {
      return '年卡会员';
    }

    return '其他充值';
  }

  private formatRevenueTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
  }

  private calcRevenuePeakFen(
    orders: Array<{ amount: number; createdAt: Date }>,
  ): number {
    const dailyTotals = new Map<string, number>();
    for (const order of orders) {
      const key = formatDateLabel(order.createdAt);
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + order.amount);
    }

    return Math.max(0, ...dailyTotals.values());
  }

  // ──────────────────────────────────────────────
  // 内部：Pulse 目标门店解析
  // ──────────────────────────────────────────────

  private async resolveDashboardTargetStore(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
    notFoundMessage: string,
  ): Promise<PulseTargetStoreSummary> {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      requestedStoreId,
      persistResolvedSelection: true,
      notFoundMessage,
    });
  }

  // ──────────────────────────────────────────────
  // 内部：构建销售趋势
  // ──────────────────────────────────────────────

  private async buildSalesTrend(
    storeIds: number[],
    period: PulseDashboardPeriodValue,
    currentRange: TimeRange,
  ): Promise<PulseDashboardSalesTrendDto> {
    if (period === 'year') {
      return this.buildYearTrend(storeIds, currentRange);
    }

    return this.buildDayBucketTrend(storeIds, period, currentRange);
  }

  private async buildYearTrend(
    storeIds: number[],
    currentRange: TimeRange,
  ): Promise<PulseDashboardSalesTrendDto> {
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
      },
      select: { totalRevenue: true, date: true },
    });

    const byMonth: number[] = Array.from({ length: 12 }, () => 0);
    for (const row of rows) {
      const month = row.date.getMonth();
      byMonth[month] = new Decimal(byMonth[month])
        .plus(row.totalRevenue)
        .toDecimalPlaces(2)
        .toNumber();
    }

    const currentMonth = new Date().getMonth();
    const actual = byMonth.map((v, idx) =>
      idx <= currentMonth ? v : null,
    ) as Array<number | null>;

    return { categories: YEAR_MONTH_LABELS, actual, isYearMode: true };
  }

  private async buildDayBucketTrend(
    storeIds: number[],
    period: PulseDashboardPeriodValue,
    currentRange: TimeRange,
  ): Promise<PulseDashboardSalesTrendDto> {
    if (period === 'today') {
      return this.buildTodayBucketTrend(storeIds, currentRange);
    }

    // week / month：按天聚合
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
      },
      select: { totalRevenue: true, date: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    const dayMap = new Map<string, number>();
    for (const row of rows) {
      const label = formatDateLabel(row.date);
      dayMap.set(
        label,
        new Decimal(dayMap.get(label) ?? 0)
          .plus(row.totalRevenue)
          .toDecimalPlaces(2)
          .toNumber(),
      );
    }

    return {
      categories: Array.from(dayMap.keys()),
      actual: Array.from(dayMap.values()) as Array<number | null>,
      isYearMode: false,
    };
  }

  private async buildTodayBucketTrend(
    storeIds: number[],
    currentRange: TimeRange,
  ): Promise<PulseDashboardSalesTrendDto> {
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: new Date(currentRange.start),
          lte: new Date(currentRange.end),
        },
      },
      select: { totalRevenue: true, date: true },
    });

    const buckets: number[] = Array.from(
      { length: TODAY_BUCKET_HOURS.length },
      () => 0,
    );
    for (const row of rows) {
      const hour = row.date.getHours();
      const bucketIdx = TODAY_BUCKET_HOURS.findIndex((h, i) => {
        const nextH = TODAY_BUCKET_HOURS[i + 1];
        return hour >= h && (nextH === undefined || hour < nextH);
      });
      if (bucketIdx >= 0) {
        buckets[bucketIdx] = new Decimal(buckets[bucketIdx])
          .plus(row.totalRevenue)
          .toDecimalPlaces(2)
          .toNumber();
      }
    }

    const currentHour = new Date().getHours();
    const actual = buckets.map((v, idx) => {
      const bucketHour = TODAY_BUCKET_HOURS[idx];
      return currentHour >= bucketHour ? v : null;
    }) as Array<number | null>;

    return { categories: TODAY_BUCKET_LABELS, actual, isYearMode: false };
  }

  // ──────────────────────────────────────────────
  // 内部：构建响应对象
  // ──────────────────────────────────────────────

  private buildStats(
    period: PulseDashboardPeriodValue,
    current: { totalRevenue: number; orderCount: number },
    compare: { orderCount: number },
    currentProfit: number,
    compareProfit: number,
    currentCost: number,
  ): PulseDashboardStatsDto {
    const profitChange =
      compareProfit !== 0
        ? new Decimal(currentProfit - compareProfit)
            .div(Math.abs(compareProfit))
            .mul(100)
            .toDecimalPlaces(1)
            .toNumber()
        : null;

    const orderChange =
      compare.orderCount !== 0
        ? new Decimal(current.orderCount - compare.orderCount)
            .div(compare.orderCount)
            .mul(100)
            .toDecimalPlaces(1)
            .toNumber()
        : null;

    return {
      profitLabel: PERIOD_PROFIT_LABEL[period],
      profit: currentProfit,
      profitChange,
      orderLabel: PERIOD_ORDER_LABEL[period],
      orderCount: current.orderCount,
      orderChange,
      revenue: current.totalRevenue,
      totalCost: currentCost,
    };
  }

  private buildMeta(
    period: PulseDashboardPeriodValue,
    storeId: number | null,
    storeCount: number,
    currentRange: TimeRange,
  ): PulseDashboardMetaDto {
    return {
      period,
      storeId,
      storeCount,
      startAt: currentRange.start,
      endAt: currentRange.end,
      generatedAt: Date.now(),
    };
  }
}
