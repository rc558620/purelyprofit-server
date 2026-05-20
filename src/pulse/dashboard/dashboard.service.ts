import { ForbiddenException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { BusinessAnalysisService } from '../../dashboard/business-analysis/business-analysis.service';
import type { GetBusinessAnalysisQueryDto } from '../../dashboard/business-analysis/dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from '../../dashboard/business-analysis/dto/business-analysis-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
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

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class PulseDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregator: DashboardAggregatorService,
    private readonly businessAnalysisService: BusinessAnalysisService,
  ) {}

  // ──────────────────────────────────────────────
  // 跨店经营总览
  // ──────────────────────────────────────────────

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    const period = queryDto.period ?? 'today';
    const { storeIds, resolvedStoreId } = await this.resolveOwnerStoreIds(
      user,
      queryDto.storeId,
    );

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
      meta: this.buildMeta(
        period,
        resolvedStoreId,
        storeIds.length,
        currentRange,
      ),
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
    const { storeIds } = await this.resolveOwnerStoreIds(user, undefined);

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
      meta: this.buildMeta(period, null, storeIds.length, currentRange),
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
    const { storeIds, resolvedStoreId } = await this.resolveOwnerStoreIds(
      user,
      queryDto.storeId,
    );

    if (!resolvedStoreId && storeIds.length !== 1) {
      throw new ForbiddenException(
        '经营分析页暂不支持多门店聚合，请选择单一门店后重试',
      );
    }

    const targetStoreId = resolvedStoreId ?? storeIds[0];

    const proxyQuery: GetBusinessAnalysisQueryDto = {
      period: queryDto.period ?? 'month',
      storeId: targetStoreId,
      startTime: queryDto.startTime,
      endTime: queryDto.endTime,
    };

    return this.businessAnalysisService.getAnalysis(user, proxyQuery);
  }

  // ──────────────────────────────────────────────
  // Home 页聚合数据
  // ──────────────────────────────────────────────

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

  // ──────────────────────────────────────────────
  // 内部：老板门店 ID 解析
  // ──────────────────────────────────────────────

  private async resolveOwnerStoreIds(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
  ): Promise<{ storeIds: number[]; resolvedStoreId: number | null }> {
    const stores = await this.prisma.store.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    });

    const ownedStoreIds = stores.map((s) => s.id);

    if (ownedStoreIds.length === 0) {
      throw new ForbiddenException('当前账号未拥有任何门店');
    }

    if (requestedStoreId !== undefined) {
      if (!ownedStoreIds.includes(requestedStoreId)) {
        throw new ForbiddenException('无权访问指定门店的数据');
      }

      return {
        storeIds: [requestedStoreId],
        resolvedStoreId: requestedStoreId,
      };
    }

    return { storeIds: ownedStoreIds, resolvedStoreId: null };
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
