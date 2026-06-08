import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import type { PrismaService } from '../../../prisma/prisma.service';
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
  subtractMoney,
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
    });
    expect(costFindMany).toHaveBeenCalledWith({
      ...buildCostRecordQuery(18, {
        start: previousRange.start,
        end: currentRange.end,
      }),
      select: PROFIT_DETAIL_COST_RECORD_SELECT,
    });
  });

  it('空态 helper 会返回稳定的默认结构', () => {
    expect(buildEmptySummary()).toEqual({
      revenue: 0,
      totalCost: 0,
      netProfit: 0,
      profitRate: 0,
      compareLastPeriod: null,
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
    expect(createEmptySalesAggregation()).toEqual({
      revenue: 0,
      orderCount: 0,
      dailyRevenueMap: new Map<number, number>(),
      rankMap: new Map<string, AggregatedRankProduct>(),
    });
  });

  it('aggregateSales 会过滤区间外数据并合并商品统计', () => {
    const rows: SaleOrderItemRow[] = [
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('6.50'),
        profit: new Prisma.Decimal('2.50'),
        quantity: 2,
        image: null,
        order: { date: new Date(2026, 4, 12, 10, 0, 0, 0) },
      },
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('6.50'),
        profit: new Prisma.Decimal('2.50'),
        quantity: 1,
        image: 'https://example.com/coke.png',
        order: { date: new Date(2026, 4, 12, 13, 0, 0, 0) },
      },
      {
        productId: null,
        productName: '快照商品',
        categoryName: '零食',
        salePrice: new Prisma.Decimal('9.00'),
        profit: new Prisma.Decimal('3.00'),
        quantity: 1,
        image: null,
        order: { date: new Date(2026, 4, 13, 10, 0, 0, 0) },
      },
      {
        productId: 3,
        productName: '区间外商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('8.00'),
        profit: new Prisma.Decimal('2.00'),
        quantity: 1,
        image: null,
        order: { date: new Date(2026, 4, 10, 10, 0, 0, 0) },
      },
    ];

    const result = aggregateSales(
      rows,
      new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    );

    expect(result.revenue).toBe(28.5);
    expect(result.orderCount).toBe(4);
    expect(result.dailyRevenueMap).toEqual(
      new Map<number, number>([
        [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 19.5],
        [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 9],
      ]),
    );
    expect(Array.from(result.rankMap.values())).toEqual([
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
        amount: new Prisma.Decimal('8.00'),
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('3.00'),
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'rent',
        amount: new Prisma.Decimal('1.50'),
        date: new Date(2026, 4, 13, 11, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: new Prisma.Decimal('4.00'),
        date: new Date(2026, 4, 10, 9, 0, 0, 0),
      },
    ];

    const result = aggregateCosts(
      rows,
      new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    );

    expect(result.totalCost).toBe(12.5);
    expect(result.dailyCostMap).toEqual(
      new Map<number, number>([
        [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 8],
        [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 4.5],
      ]),
    );
    expect(result.categoryCostMap).toEqual(
      new Map<CostRecordRow['category'], number>([
        ['rent', 9.5],
        ['purchase', 3],
      ]),
    );
  });

  it('汇总与趋势 helper 会正确计算比例、变化率与每日利润', () => {
    expect(buildSummary(22, 24, 11, 11, 3)).toEqual({
      revenue: 22,
      totalCost: 11,
      netProfit: 11,
      profitRate: 50,
      compareLastPeriod: -8.33,
      orderCount: 3,
    });
    expect(
      buildDailyProfits(
        {
          start: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
          end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
        },
        new Map<number, number>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 13],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 9],
        ]),
        new Map<number, number>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 8],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 3],
        ]),
      ),
    ).toEqual([
      { dateLabel: '05/12', revenue: 13, cost: 8, profit: 5 },
      { dateLabel: '05/13', revenue: 9, cost: 3, profit: 6 },
    ]);
    expect(subtractMoney(12.55, 1.23)).toBe(11.32);
  });

  it('排行与成本分解 helper 会按利润和金额倒序输出', () => {
    const rankMap = new Map<string, AggregatedRankProduct>([
      [
        '1',
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          price: 6.5,
          profitPerUnit: 2.5,
          quantity: 2,
          totalProfit: 5,
          totalRevenue: 13,
          image: 'https://example.com/coke.png',
        },
      ],
      [
        '2',
        {
          id: '2',
          name: '奥利奥',
          category: '零食',
          price: 9,
          profitPerUnit: 3,
          quantity: 1,
          totalProfit: 3,
          totalRevenue: 9,
        },
      ],
    ]);
    const categoryCostMap = new Map<CostRecordRow['category'], number>([
      ['purchase', 3],
      ['rent', 8],
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
    expect(buildCostBreakdown(categoryCostMap, 11)).toEqual([
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
        revenue: 22,
        orderCount: 3,
        dailyRevenueMap: new Map<number, number>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 13],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 9],
        ]),
        rankMap: new Map<string, AggregatedRankProduct>([
          [
            '1',
            {
              id: '1',
              name: '可口可乐 330ml',
              category: '饮品',
              price: 6.5,
              profitPerUnit: 2.5,
              quantity: 2,
              totalProfit: 5,
              totalRevenue: 13,
              image: 'https://example.com/coke.png',
            },
          ],
        ]),
      },
      previousSales: {
        revenue: 24,
        orderCount: 3,
        dailyRevenueMap: new Map<number, number>(),
        rankMap: new Map<string, AggregatedRankProduct>(),
      },
      currentCosts: {
        totalCost: 11,
        dailyCostMap: new Map<number, number>([
          [new Date(2026, 4, 12, 0, 0, 0, 0).getTime(), 8],
          [new Date(2026, 4, 13, 0, 0, 0, 0).getTime(), 3],
        ]),
        categoryCostMap: new Map<CostRecordRow['category'], number>([
          ['rent', 8],
          ['purchase', 3],
        ]),
      },
      netProfit: 11,
    };

    expect(buildProfitDetailResponse(snapshot)).toEqual({
      summary: {
        revenue: 22,
        totalCost: 11,
        netProfit: 11,
        profitRate: 50,
        compareLastPeriod: -8.33,
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
        compareLastPeriod: -8.33,
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
