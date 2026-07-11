import { BadRequestException } from '@nestjs/common';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import {
  aggregateCosts,
  aggregateSales,
  createEmptySalesAggregation,
} from './profit-detail.domain';
import {
  buildCostBreakdown,
  buildDailyProfits,
  buildEmptyProfitDetailResponse,
  buildEmptyProfitReportResponse,
  buildEmptySummary,
  buildMonthlyProfits,
  buildProductRanking,
  buildProfitDetailResponse,
  buildProfitReportResponse,
  buildReportProducts,
  buildSummary,
} from './profit-detail.mapper';
import {
  buildCostRecordQuery,
  buildSaleOrderItemQuery,
  fetchProfitRows,
} from './profit-detail.query';
import {
  PROFIT_DETAIL_COST_RECORD_SELECT,
  PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
  type AggregatedRankProduct,
  type CostRecordRow,
  type ProfitAccessibleRange,
  type ProfitMetricsSnapshot,
  type SaleOrderItemRow,
} from './profit-detail.types';
import {
  buildClampedRanges,
  buildCurrentRange,
  buildPreviousRange,
  buildQueryInput,
  resolveProfitQueryRange,
} from './profit-detail.utils';

describe('profit-detail.utils', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 12, 0, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('buildQueryInput 会拷贝 DTO 需要的查询字段', () => {
    expect(
      buildQueryInput({
        storeId: 18,
        period: 'custom_range',
        year: 2025,
        customDate: 123,
        rangeStartDate: 456,
        rangeEndDate: 789,
        startTime: 321,
        endTime: 654,
      }),
    ).toEqual({
      storeId: 18,
      period: 'custom_range',
      year: 2025,
      customDate: 123,
      rangeStartDate: 456,
      rangeEndDate: 789,
      startTime: 321,
      endTime: 654,
    });
  });

  it('buildCurrentRange 会按 today 返回当天起点到当前时间', () => {
    expect(buildCurrentRange({ period: 'today' })).toEqual({
      start: new Date(2026, 4, 14, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 14, 12, 0, 0, 0).getTime(),
    });
  });

  it('buildCurrentRange 会按 custom_range 归一化开始和结束日期', () => {
    expect(
      buildCurrentRange({
        period: 'custom_range',
        rangeStartDate: new Date(2026, 4, 13, 12, 0, 0, 0).getTime(),
        rangeEndDate: new Date(2026, 4, 12, 8, 0, 0, 0).getTime(),
      }),
    ).toEqual({
      start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    });

    expect(
      buildCurrentRange({
        period: 'custom_range',
        startTime: new Date(2026, 4, 13, 12, 0, 0, 0).getTime(),
        endTime: new Date(2026, 4, 12, 8, 0, 0, 0).getTime(),
      }),
    ).toEqual({
      start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    });
  });

  it('buildCurrentRange 会兼容 custom_month 的 startTime/endTime 参数', () => {
    expect(
      buildCurrentRange({
        period: 'custom_month',
        startTime: new Date(2026, 4, 25, 10, 30, 0, 0).getTime(),
        endTime: new Date(2026, 4, 25, 23, 59, 59, 999).getTime(),
      }),
    ).toEqual({
      start: new Date(2026, 4, 25, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 25, 23, 59, 59, 999).getTime(),
    });
  });

  it('buildCurrentRange 在缺少 customDate/startTime 时抛错', () => {
    expect(() => buildCurrentRange({ period: 'custom_month' })).toThrow(
      BadRequestException,
    );
  });

  it('buildPreviousRange 会为 year 返回上一整年，为其他周期返回等长上期', () => {
    expect(
      buildPreviousRange(
        { period: 'year' },
        {
          start: new Date(2025, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(2025, 11, 31, 23, 59, 59, 999).getTime(),
        },
      ),
    ).toEqual({
      start: new Date(2024, 0, 1, 0, 0, 0, 0).getTime(),
      end: new Date(2024, 11, 31, 23, 59, 59, 999).getTime(),
    });

    expect(
      buildPreviousRange(
        { period: 'custom_range' },
        {
          start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
          end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
        },
      ),
    ).toEqual({
      start: new Date(2026, 4, 10, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 11, 23, 59, 59, 999).getTime(),
    });
  });

  it('查询 helper 会统一组装区间与 Prisma 查询参数', () => {
    const currentRange: ProfitAccessibleRange = {
      start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
      clamped: false,
      empty: false,
    };
    const previousRange: ProfitAccessibleRange = {
      start: new Date(2026, 4, 10, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 11, 23, 59, 59, 999).getTime(),
      clamped: false,
      empty: false,
    };
    const queryRange = resolveProfitQueryRange(currentRange, previousRange);

    expect(queryRange).toEqual({
      start: previousRange.start,
      end: currentRange.end,
    });
    expect(buildSaleOrderItemQuery(18, queryRange)).toEqual({
      where: {
        storeId: 18,
        order: {
          date: {
            gte: new Date(previousRange.start),
            lte: new Date(currentRange.end),
          },
        },
      },
      orderBy: [{ order: { date: 'asc' } }, { id: 'asc' }],
    });
    expect(buildCostRecordQuery(18, queryRange)).toEqual({
      where: {
        storeId: 18,
        date: {
          gte: new Date(previousRange.start),
          lte: new Date(currentRange.end),
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
  });

  it('buildClampedRanges 会并发调用会员历史裁剪能力', async () => {
    const clampHistoryRange = jest
      .fn()
      .mockResolvedValueOnce({
        start: 10,
        end: 20,
        clamped: true,
        empty: false,
      })
      .mockResolvedValueOnce({
        start: 1,
        end: 9,
        clamped: false,
        empty: true,
      });
    const platformMembershipAccessService = {
      clampHistoryRange,
    } as unknown as PlatformMembershipAccessService;

    await expect(
      buildClampedRanges(
        platformMembershipAccessService,
        18,
        { start: 10, end: 20 },
        { start: 1, end: 9 },
      ),
    ).resolves.toEqual({
      currentRange: { start: 10, end: 20, clamped: true, empty: false },
      previousRange: { start: 1, end: 9, clamped: false, empty: true },
    });
    expect(clampHistoryRange).toHaveBeenNthCalledWith(
      1,
      18,
      {
        start: 10,
        end: 20,
      },
      false,
    );
    expect(clampHistoryRange).toHaveBeenNthCalledWith(
      2,
      18,
      {
        start: 1,
        end: 9,
      },
      false,
    );
  });

  it('fetchProfitRows 会统一复用 query helper 与 select 常量', async () => {
    const saleFindMany = jest.fn().mockResolvedValue([{ id: 'sale' }]);
    const costFindMany = jest.fn().mockResolvedValue([{ id: 'cost' }]);
    const prisma = {
      saleOrderItem: { findMany: saleFindMany },
      costRecord: { findMany: costFindMany },
    } as unknown as PrismaService;
    const currentRange: ProfitAccessibleRange = {
      start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
      clamped: false,
      empty: false,
    };
    const previousRange: ProfitAccessibleRange = {
      start: new Date(2026, 4, 10, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 11, 23, 59, 59, 999).getTime(),
      clamped: false,
      empty: false,
    };

    await expect(
      fetchProfitRows(prisma, 18, currentRange, previousRange),
    ).resolves.toEqual({
      saleRows: [{ id: 'sale' }],
      costRows: [{ id: 'cost' }],
    });
    expect(saleFindMany).toHaveBeenCalledWith({
      ...buildSaleOrderItemQuery(18, {
        start: previousRange.start,
        end: currentRange.end,
      }),
      select: PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
      skip: 0,
      take: 5000,
    });
    expect(costFindMany).toHaveBeenCalledWith({
      ...buildCostRecordQuery(18, {
        start: previousRange.start,
        end: currentRange.end,
      }),
      select: PROFIT_DETAIL_COST_RECORD_SELECT,
      skip: 0,
      take: 5000,
    });
  });

  it('空态 helper 会返回稳定的默认结构', () => {
    expect(buildEmptySummary()).toEqual({
      revenue: 0,
      totalCost: 0,
      netProfit: 0,
      profitRate: 0,
      revenueCompareLastPeriod: null,
      profitCompareLastPeriod: null,
      costCompareLastPeriod: null,
      orderCount: 0,
    });
    expect(buildEmptyProfitDetailResponse()).toEqual({
      summary: buildEmptySummary(),
      dailyProfits: [],
      productRanking: [],
      costBreakdown: [],
    });
    expect(buildEmptyProfitReportResponse()).toEqual({
      summary: buildEmptySummary(),
      products: [],
    });
    const emptyAgg = createEmptySalesAggregation();
    expect(emptyAgg.revenue.equals(Money.zero())).toBe(true);
    expect(emptyAgg.orderCount).toBe(0);
    expect(emptyAgg.dailyRevenueMap).toEqual(new Map<number, Money>());
    expect(emptyAgg.rankMap).toEqual(new Map<string, AggregatedRankProduct>());
  });

  it('aggregateSales 会过滤区间外数据并合并商品统计', () => {
    const rows: SaleOrderItemRow[] = [
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 650,
        profit: 250,
        quantity: 2,
        image: null,
        order: {
          id: 1,
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 650,
        profit: 250,
        quantity: 1,
        image: 'https://example.com/coke.png',
        order: {
          id: 2,
          date: new Date(2026, 4, 12, 13, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: null,
        productName: '快照商品',
        categoryName: '零食',
        salePrice: 900,
        profit: 300,
        quantity: 1,
        image: null,
        order: {
          id: 3,
          date: new Date(2026, 4, 13, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 3,
        productName: '区间外商品',
        categoryName: '饮品',
        salePrice: 800,
        profit: 200,
        quantity: 1,
        image: null,
        order: {
          id: 4,
          date: new Date(2026, 4, 10, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: null,
        productName: '续费抵扣',
        categoryName: '场地费',
        salePrice: -3000,
        profit: -3000,
        quantity: 1,
        image: null,
        order: {
          id: 5,
          date: new Date(2026, 4, 12, 14, 0, 0, 0),
          spaceSession: null,
        },
      },
    ];

    const result = aggregateSales(
      rows,
      new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    );

    expect(result.revenue.toOutputYuan()).toBe(28.5);
    // orderCount 统计独立订单数（3 个订单，续费抵扣行被排除不计入）
    expect(result.orderCount).toBe(3);
    expect(
      Array.from(result.dailyRevenueMap.entries()).map(
        ([k, v]) => [k, v.toOutputYuan()] as [number, number],
      ),
    ).toEqual([
      [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 19.5],
      [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 9],
    ]);
    const rankValues = Array.from(result.rankMap.values());
    expect(
      rankValues.map((item) => ({
        ...item,
        price: item.price.toOutputYuan(),
        profitPerUnit: item.profitPerUnit.toOutputYuan(),
        totalProfit: item.totalProfit.toOutputYuan(),
        totalRevenue: item.totalRevenue.toOutputYuan(),
      })),
    ).toEqual([
      {
        id: '1',
        name: '可口可乐 330ml',
        category: '饮品',
        price: 6.5,
        profitPerUnit: 2.5,
        quantity: 3,
        totalProfit: 7.5,
        totalRevenue: 19.5,
        image: 'https://example.com/coke.png',
      },
      {
        id: 'snapshot:快照商品',
        name: '快照商品',
        category: '零食',
        price: 9,
        profitPerUnit: 3,
        quantity: 1,
        totalProfit: 3,
        totalRevenue: 9,
      },
    ]);
  });

  it('aggregateCosts 会过滤区间外数据并累计天维度与分类维度成本', () => {
    const rows: CostRecordRow[] = [
      {
        category: 'rent',
        amount: 800,
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: 300,
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'rent',
        amount: 150,
        date: new Date(2026, 4, 13, 11, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: 400,
        date: new Date(2026, 4, 10, 9, 0, 0, 0),
      },
    ];

    const result = aggregateCosts(
      rows,
      new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    );

    expect(result.totalCost.toOutputYuan()).toBe(12.5);
    expect(
      Array.from(result.dailyCostMap.entries()).map(
        ([k, v]) => [k, v.toOutputYuan()] as [number, number],
      ),
    ).toEqual([
      [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 8],
      [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 4.5],
    ]);
    expect(
      Array.from(result.categoryCostMap.entries()).map(
        ([k, v]) => [k, v.toOutputYuan()] as [string, number],
      ),
    ).toEqual([
      ['rent', 9.5],
      ['purchase', 3],
    ]);
  });

  it('汇总与趋势 helper 会正确计算比例、变化率与每日利润', () => {
    // buildSummary(current=22, previous=24, cost=11, previousCost=10, netProfit=11, previousNetProfit=14, orderCount=3)
    expect(buildSummary(22, 24, 11, 10, 11, 14, 3)).toEqual({
      revenue: 22,
      totalCost: 11,
      netProfit: 11,
      profitRate: 50,
      revenueCompareLastPeriod: -8.33,
      profitCompareLastPeriod: -21.43,
      costCompareLastPeriod: 10,
      orderCount: 3,
    });
    expect(
      buildDailyProfits(
        {
          start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
          end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
        },
        new Map<number, Money>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), Money.fromDbCents(1300)],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), Money.fromDbCents(900)],
        ]),
        new Map<number, Money>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), Money.fromDbCents(800)],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), Money.fromDbCents(300)],
        ]),
      ),
    ).toEqual([
      { dateLabel: '05/12', revenue: 13, cost: 8, profit: 5 },
      { dateLabel: '05/13', revenue: 9, cost: 3, profit: 6 },
    ]);
  });

  it('buildMonthlyProfits 会按月聚合全年趋势，profit 由 Money.subtract() 计算', () => {
    const may1 = new Date(2025, 0, 15, 10, 0, 0, 0).getTime();
    const may2 = new Date(2025, 1, 20, 10, 0, 0, 0).getTime();
    const may3 = new Date(2025, 0, 25, 10, 0, 0, 0).getTime();
    const may4 = new Date(2025, 5, 10, 10, 0, 0, 0).getTime();
    const dailyRevenueMap = new Map<number, Money>([
      [may1, Money.fromDbCents(2000)],
      [may3, Money.fromDbCents(3000)],
      [may2, Money.fromDbCents(5000)],
      [may4, Money.fromDbCents(4000)],
    ]);
    const dailyCostMap = new Map<number, Money>([
      [may1, Money.fromDbCents(800)],
      [may3, Money.fromDbCents(1200)],
      [may2, Money.fromDbCents(2000)],
      [may4, Money.fromDbCents(600)],
    ]);
    const result = buildMonthlyProfits(
      {
        start: new Date(2025, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(2025, 11, 31, 23, 59, 59, 999).getTime(),
      },
      dailyRevenueMap,
      dailyCostMap,
    );
    expect(result).toHaveLength(12);
    // 1月: revenue 50, cost 20, profit 30
    expect(result[0]).toEqual({ dateLabel: '1月', revenue: 50, cost: 20, profit: 30 });
    // 2月: revenue 50, cost 20, profit 30
    expect(result[1]).toEqual({ dateLabel: '2月', revenue: 50, cost: 20, profit: 30 });
    // 3-5月: 无数据
    expect(result[2]).toEqual({ dateLabel: '3月', revenue: 0, cost: 0, profit: 0 });
    expect(result[3]).toEqual({ dateLabel: '4月', revenue: 0, cost: 0, profit: 0 });
    expect(result[4]).toEqual({ dateLabel: '5月', revenue: 0, cost: 0, profit: 0 });
    // 6月: revenue 40, cost 6, profit 34
    expect(result[5]).toEqual({ dateLabel: '6月', revenue: 40, cost: 6, profit: 34 });
    // 7-12月: 无数据
    expect(result[6]).toEqual({ dateLabel: '7月', revenue: 0, cost: 0, profit: 0 });
  });

  it('排行与成本分解 helper 会按利润和金额倒序输出', () => {
    const rankMap = new Map<string, AggregatedRankProduct>([
      [
        '1',
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          price: Money.fromDbCents(650),
          profitPerUnit: Money.fromDbCents(250),
          quantity: 2,
          totalProfit: Money.fromDbCents(500),
          totalRevenue: Money.fromDbCents(1300),
          image: 'https://example.com/coke.png',
        },
      ],
      [
        '2',
        {
          id: '2',
          name: '奥利奥',
          category: '零食',
          price: Money.fromDbCents(900),
          profitPerUnit: Money.fromDbCents(300),
          quantity: 1,
          totalProfit: Money.fromDbCents(300),
          totalRevenue: Money.fromDbCents(900),
        },
      ],
    ]);
    const categoryCostMap = new Map<CostRecordRow['category'], Money>([
      ['purchase', Money.fromDbCents(300)],
      ['rent', Money.fromDbCents(800)],
    ]);

    expect(buildReportProducts(rankMap)).toEqual([
      {
        id: '1',
        name: '可口可乐 330ml',
        category: '饮品',
        quantity: 2,
        totalRevenue: 13,
        totalProfit: 5,
        profitRate: 38.46,
      },
      {
        id: '2',
        name: '奥利奥',
        category: '零食',
        quantity: 1,
        totalRevenue: 9,
        totalProfit: 3,
        profitRate: 33.33,
      },
    ]);
    expect(buildProductRanking(rankMap)).toEqual([
      {
        id: '1',
        name: '可口可乐 330ml',
        category: '饮品',
        price: 6.5,
        profitPerUnit: 2.5,
        quantity: 2,
        totalProfit: 5,
        totalRevenue: 13,
        profitRate: 38.46,
        image: 'https://example.com/coke.png',
      },
      {
        id: '2',
        name: '奥利奥',
        category: '零食',
        price: 9,
        profitPerUnit: 3,
        quantity: 1,
        totalProfit: 3,
        totalRevenue: 9,
        profitRate: 33.33,
      },
    ]);
    expect(buildCostBreakdown(categoryCostMap, Money.fromDbCents(1100))).toEqual([
      { label: '租金', amount: 8, color: '#6366f1', percentage: 72.73 },
      { label: '进货', amount: 3, color: '#84cc16', percentage: 27.27 },
    ]);
  });

  it('响应 mapper helper 会稳定组装 detail 和 report 返回结构', () => {
    const snapshot: ProfitMetricsSnapshot = {
      currentRange: {
        start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
        clamped: false,
        empty: false,
      },
      currentSales: {
        revenue: Money.fromDbCents(2200),
        orderCount: 3,
        dailyRevenueMap: new Map<number, Money>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), Money.fromDbCents(1300)],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), Money.fromDbCents(900)],
        ]),
        rankMap: new Map<string, AggregatedRankProduct>([
          [
            '1',
            {
              id: '1',
              name: '可口可乐 330ml',
              category: '饮品',
              price: Money.fromDbCents(650),
              profitPerUnit: Money.fromDbCents(250),
              quantity: 2,
              totalProfit: Money.fromDbCents(500),
              totalRevenue: Money.fromDbCents(1300),
              image: 'https://example.com/coke.png',
            },
          ],
        ]),
      },
      previousSales: {
        revenue: Money.fromDbCents(2400),
        orderCount: 3,
        dailyRevenueMap: new Map<number, Money>(),
        rankMap: new Map<string, AggregatedRankProduct>(),
      },
      currentCosts: {
        totalCost: Money.fromDbCents(1100),
        dailyCostMap: new Map<number, Money>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), Money.fromDbCents(800)],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), Money.fromDbCents(300)],
        ]),
        categoryCostMap: new Map<CostRecordRow['category'], Money>([
          ['rent', Money.fromDbCents(800)],
          ['purchase', Money.fromDbCents(300)],
        ]),
      },
      previousCosts: {
        totalCost: Money.fromDbCents(1000),
        dailyCostMap: new Map<number, Money>(),
        categoryCostMap: new Map<CostRecordRow['category'], Money>(),
      },
      netProfit: Money.fromDbCents(1100),
      previousNetProfit: Money.fromDbCents(1400),
    };

    expect(buildProfitDetailResponse(snapshot)).toEqual({
      summary: {
        revenue: 22,
        totalCost: 11,
        netProfit: 11,
        profitRate: 50,
        revenueCompareLastPeriod: -8.33,
        profitCompareLastPeriod: -21.43,
        costCompareLastPeriod: 10,
        orderCount: 3,
      },
      dailyProfits: [
        { dateLabel: '05/12', revenue: 13, cost: 8, profit: 5 },
        { dateLabel: '05/13', revenue: 9, cost: 3, profit: 6 },
      ],
      productRanking: [
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          price: 6.5,
          profitPerUnit: 2.5,
          quantity: 2,
          totalProfit: 5,
          totalRevenue: 13,
          profitRate: 38.46,
          image: 'https://example.com/coke.png',
        },
      ],
      costBreakdown: [
        { label: '租金', amount: 8, color: '#6366f1', percentage: 72.73 },
        { label: '进货', amount: 3, color: '#84cc16', percentage: 27.27 },
      ],
    });
    expect(buildProfitReportResponse(snapshot)).toEqual({
      summary: {
        revenue: 22,
        totalCost: 11,
        netProfit: 11,
        profitRate: 50,
        revenueCompareLastPeriod: -8.33,
        profitCompareLastPeriod: -21.43,
        costCompareLastPeriod: 10,
        orderCount: 3,
      },
      products: [
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          quantity: 2,
          totalRevenue: 13,
          totalProfit: 5,
          profitRate: 38.46,
        },
      ],
    });
  });
});
