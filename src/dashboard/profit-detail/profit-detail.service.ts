import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  toDecimalNumber,
  toOptionalMediaText,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { GetProfitDetailQueryDto } from './dto/profit-detail-query.dto';
import type {
  CostBreakdownItemDto,
  DailyProfitDto,
  ProductRankItemDto,
  ProfitDetailResponseDto,
  ProfitReportProductRowDto,
  ProfitReportResponseDto,
  ProfitSummaryDto,
} from './dto/profit-detail-response.dto';
import {
  PROFIT_DETAIL_COST_META,
  type ProfitDetailPeriodValue,
} from './profit-detail.types';

const DAY_MS = 86_400_000;
const CHART_DAY_LIMIT = 365;

type SaleOrderItemRow = {
  productId: number | null;
  productName: string;
  categoryName: string;
  salePrice: Prisma.Decimal;
  profit: Prisma.Decimal;
  quantity: number;
  image: string | null;
  order: {
    date: Date;
  };
};

type CostRecordRow = {
  category: keyof typeof PROFIT_DETAIL_COST_META;
  amount: Prisma.Decimal;
  date: Date;
};

interface ProfitDetailQueryInput {
  storeId?: number;
  period?: ProfitDetailPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

interface ProfitDateRange {
  start: number;
  end: number;
}

interface AggregatedRankProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  profitPerUnit: number;
  quantity: number;
  totalProfit: number;
  totalRevenue: number;
  image?: string;
}

interface SalesAggregationResult {
  revenue: number;
  orderCount: number;
  dailyRevenueMap: Map<number, number>;
  rankMap: Map<string, AggregatedRankProduct>;
}

interface CostAggregationResult {
  totalCost: number;
  dailyCostMap: Map<number, number>;
  categoryCostMap: Map<keyof typeof PROFIT_DETAIL_COST_META, number>;
}

@Injectable()
export class ProfitDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getProfitDetail(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitDetailResponseDto> {
    const query: ProfitDetailQueryInput = {
      storeId: queryDto.storeId,
      period: queryDto.period,
      year: queryDto.year,
      customDate: queryDto.customDate,
      rangeStartDate: queryDto.rangeStartDate,
      rangeEndDate: queryDto.rangeEndDate,
    };

    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店利润详情',
    );

    const currentRange = this.buildCurrentRange(query);
    const previousRange = this.buildPreviousRange(query, currentRange);
    const queryStart = Math.min(currentRange.start, previousRange.start);

    const [saleRows, costRows] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: {
            date: {
              gte: new Date(queryStart),
              lte: new Date(currentRange.end),
            },
          },
        },
        select: {
          productId: true,
          productName: true,
          categoryName: true,
          salePrice: true,
          profit: true,
          quantity: true,
          image: true,
          order: {
            select: {
              date: true,
            },
          },
        },
        orderBy: [{ order: { date: 'asc' } }, { id: 'asc' }],
      }),
      this.prisma.costRecord.findMany({
        where: {
          storeId,
          date: {
            gte: new Date(queryStart),
            lte: new Date(currentRange.end),
          },
        },
        select: {
          category: true,
          amount: true,
          date: true,
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const currentSales = this.aggregateSales(
      saleRows,
      currentRange.start,
      currentRange.end,
    );
    const previousSales = this.aggregateSales(
      saleRows,
      previousRange.start,
      previousRange.end,
    );
    const currentCosts = this.aggregateCosts(
      costRows,
      currentRange.start,
      currentRange.end,
    );

    const netProfit = this.subtractMoney(
      currentSales.revenue,
      currentCosts.totalCost,
    );

    return {
      summary: this.buildSummary(
        currentSales.revenue,
        previousSales.revenue,
        currentCosts.totalCost,
        netProfit,
        currentSales.orderCount,
      ),
      dailyProfits: this.buildDailyProfits(
        query.period ?? 'month',
        currentRange,
        currentSales.dailyRevenueMap,
        currentCosts.dailyCostMap,
      ),
      productRanking: this.buildProductRanking(currentSales.rankMap),
      costBreakdown: this.buildCostBreakdown(
        currentCosts.categoryCostMap,
        currentCosts.totalCost,
      ),
    };
  }

  async getReport(
    user: AuthenticatedUser,
    queryDto: GetProfitDetailQueryDto,
  ): Promise<ProfitReportResponseDto> {
    const query: ProfitDetailQueryInput = {
      storeId: queryDto.storeId,
      period: queryDto.period,
      year: queryDto.year,
      customDate: queryDto.customDate,
      rangeStartDate: queryDto.rangeStartDate,
      rangeEndDate: queryDto.rangeEndDate,
    };

    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店利润报表',
    );

    const currentRange = this.buildCurrentRange(query);
    const previousRange = this.buildPreviousRange(query, currentRange);
    const queryStart = Math.min(currentRange.start, previousRange.start);

    const [saleRows, costRows] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: {
            date: {
              gte: new Date(queryStart),
              lte: new Date(currentRange.end),
            },
          },
        },
        select: {
          productId: true,
          productName: true,
          categoryName: true,
          salePrice: true,
          profit: true,
          quantity: true,
          image: true,
          order: {
            select: {
              date: true,
            },
          },
        },
        orderBy: [{ order: { date: 'asc' } }, { id: 'asc' }],
      }),
      this.prisma.costRecord.findMany({
        where: {
          storeId,
          date: {
            gte: new Date(queryStart),
            lte: new Date(currentRange.end),
          },
        },
        select: {
          category: true,
          amount: true,
          date: true,
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const currentSales = this.aggregateSales(
      saleRows,
      currentRange.start,
      currentRange.end,
    );
    const previousSales = this.aggregateSales(
      saleRows,
      previousRange.start,
      previousRange.end,
    );
    const currentCosts = this.aggregateCosts(
      costRows,
      currentRange.start,
      currentRange.end,
    );
    const netProfit = this.subtractMoney(
      currentSales.revenue,
      currentCosts.totalCost,
    );

    return {
      summary: this.buildSummary(
        currentSales.revenue,
        previousSales.revenue,
        currentCosts.totalCost,
        netProfit,
        currentSales.orderCount,
      ),
      products: this.buildReportProducts(currentSales.rankMap),
    };
  }

  private buildCurrentRange(query: ProfitDetailQueryInput): ProfitDateRange {
    const period = query.period ?? 'month';
    const now = Date.now();

    switch (period) {
      case 'today':
        return {
          start: this.getDayStart(now),
          end: now,
        };
      case 'week': {
        const start = new Date();
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        return {
          start: start.getTime(),
          end: now,
        };
      }
      case 'month': {
        const current = new Date();
        return {
          start: new Date(
            current.getFullYear(),
            current.getMonth(),
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
        };
      }
      case 'quarter': {
        const current = new Date();
        const quarterStartMonth = Math.floor(current.getMonth() / 3) * 3;
        return {
          start: new Date(
            current.getFullYear(),
            quarterStartMonth,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
        };
      }
      case 'year': {
        const year = query.year ?? new Date().getFullYear();
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        };
      }
      case 'custom_month': {
        if (query.customDate === undefined) {
          throw new BadRequestException('自定义单日模式需要传 customDate');
        }
        return {
          start: this.getDayStart(query.customDate),
          end: this.getDayEnd(query.customDate),
        };
      }
      case 'custom_range': {
        if (
          query.rangeStartDate === undefined ||
          query.rangeEndDate === undefined
        ) {
          throw new BadRequestException(
            '自定义区间模式需要传 rangeStartDate 和 rangeEndDate',
          );
        }
        const startDate = Math.min(query.rangeStartDate, query.rangeEndDate);
        const endDate = Math.max(query.rangeStartDate, query.rangeEndDate);
        return {
          start: this.getDayStart(startDate),
          end: this.getDayEnd(endDate),
        };
      }
    }
  }

  private buildPreviousRange(
    query: ProfitDetailQueryInput,
    currentRange: ProfitDateRange,
  ): ProfitDateRange {
    if ((query.period ?? 'month') === 'year') {
      const previousYear = new Date(currentRange.start).getFullYear() - 1;
      return {
        start: new Date(previousYear, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(previousYear, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }

    const duration = currentRange.end - currentRange.start;
    return {
      start: currentRange.start - duration - 1,
      end: currentRange.start - 1,
    };
  }

  private aggregateSales(
    rows: SaleOrderItemRow[],
    start: number,
    end: number,
  ): SalesAggregationResult {
    let revenue = 0;
    let orderCount = 0;
    const dailyRevenueMap = new Map<number, number>();
    const rankMap = new Map<string, AggregatedRankProduct>();

    for (const row of rows) {
      const timestamp = row.order.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      const price = toDecimalNumber(row.salePrice);
      const profitPerUnit = toDecimalNumber(row.profit);
      const itemRevenue = this.multiplyMoney(price, row.quantity);
      const itemProfit = this.multiplyMoney(profitPerUnit, row.quantity);
      revenue = this.addMoney(revenue, itemRevenue);
      orderCount += row.quantity;

      const dayStart = this.getDayStart(timestamp);
      dailyRevenueMap.set(
        dayStart,
        this.addMoney(dailyRevenueMap.get(dayStart) ?? 0, itemRevenue),
      );

      const rankKey =
        row.productId !== null
          ? String(row.productId)
          : `snapshot:${row.productName}`;
      const currentProduct = rankMap.get(rankKey);
      if (currentProduct) {
        currentProduct.quantity += row.quantity;
        currentProduct.totalProfit = this.addMoney(
          currentProduct.totalProfit,
          itemProfit,
        );
        currentProduct.totalRevenue = this.addMoney(
          currentProduct.totalRevenue,
          itemRevenue,
        );
        if (!currentProduct.image && row.image) {
          currentProduct.image = row.image;
        }
      } else {
        rankMap.set(rankKey, {
          id: rankKey,
          name: row.productName,
          category: row.categoryName,
          price,
          profitPerUnit,
          quantity: row.quantity,
          totalProfit: itemProfit,
          totalRevenue: itemRevenue,
          ...(toOptionalMediaText(row.image)
            ? { image: toOptionalMediaText(row.image) }
            : {}),
        });
      }
    }

    return {
      revenue,
      orderCount,
      dailyRevenueMap,
      rankMap,
    };
  }

  private aggregateCosts(
    rows: CostRecordRow[],
    start: number,
    end: number,
  ): CostAggregationResult {
    let totalCost = 0;
    const dailyCostMap = new Map<number, number>();
    const categoryCostMap = new Map<
      keyof typeof PROFIT_DETAIL_COST_META,
      number
    >();

    for (const row of rows) {
      const timestamp = row.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      const amount = toDecimalNumber(row.amount);
      totalCost = this.addMoney(totalCost, amount);

      const dayStart = this.getDayStart(timestamp);
      dailyCostMap.set(
        dayStart,
        this.addMoney(dailyCostMap.get(dayStart) ?? 0, amount),
      );
      categoryCostMap.set(
        row.category,
        this.addMoney(categoryCostMap.get(row.category) ?? 0, amount),
      );
    }

    return {
      totalCost,
      dailyCostMap,
      categoryCostMap,
    };
  }

  private buildSummary(
    revenue: number,
    previousRevenue: number,
    totalCost: number,
    netProfit: number,
    orderCount: number,
  ): ProfitSummaryDto {
    return {
      revenue,
      totalCost,
      netProfit,
      profitRate: this.calcRate(netProfit, revenue),
      compareLastPeriod: this.buildChangeRate(revenue, previousRevenue),
      orderCount,
    };
  }

  private buildDailyProfits(
    period: ProfitDetailPeriodValue,
    currentRange: ProfitDateRange,
    dailyRevenueMap: Map<number, number>,
    dailyCostMap: Map<number, number>,
  ): DailyProfitDto[] {
    const days = this.getChartDays(period, currentRange);
    const endDayStart = this.getDayStart(currentRange.end);

    return Array.from({ length: days }, (_, index) => {
      const dayStart = endDayStart - (days - 1 - index) * DAY_MS;
      const revenue = dailyRevenueMap.get(dayStart) ?? 0;
      const cost = dailyCostMap.get(dayStart) ?? 0;

      return {
        dateLabel: this.formatMonthDay(dayStart),
        revenue,
        cost,
        profit: this.subtractMoney(revenue, cost),
      };
    });
  }

  private buildReportProducts(
    rankMap: Map<string, AggregatedRankProduct>,
  ): ProfitReportProductRowDto[] {
    return Array.from(rankMap.values())
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        totalRevenue: item.totalRevenue,
        totalProfit: item.totalProfit,
        profitRate: this.calcRate(item.totalProfit, item.totalRevenue),
      }))
      .sort((left, right) => right.totalProfit - left.totalProfit);
  }

  private buildProductRanking(
    rankMap: Map<string, AggregatedRankProduct>,
  ): ProductRankItemDto[] {
    return Array.from(rankMap.values())
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        profitPerUnit: item.profitPerUnit,
        quantity: item.quantity,
        totalProfit: item.totalProfit,
        totalRevenue: item.totalRevenue,
        profitRate: this.calcRate(item.totalProfit, item.totalRevenue),
        ...(item.image ? { image: item.image } : {}),
      }))
      .sort((left, right) => right.totalProfit - left.totalProfit);
  }

  private buildCostBreakdown(
    categoryCostMap: Map<keyof typeof PROFIT_DETAIL_COST_META, number>,
    totalCost: number,
  ): CostBreakdownItemDto[] {
    return Array.from(categoryCostMap.entries())
      .map(([category, amount]) => ({
        label: PROFIT_DETAIL_COST_META[category].label,
        amount,
        color: PROFIT_DETAIL_COST_META[category].color,
        percentage: this.calcRate(amount, totalCost),
      }))
      .sort((left, right) => right.amount - left.amount);
  }

  private getChartDays(
    period: ProfitDetailPeriodValue,
    currentRange: ProfitDateRange,
  ): number {
    switch (period) {
      case 'today':
      case 'week':
        return 7;
      case 'month':
        return 30;
      case 'quarter':
        return 90;
      case 'year':
        return 365;
      case 'custom_month':
        return 1;
      case 'custom_range': {
        const diffDays = Math.ceil(
          (currentRange.end - currentRange.start) / DAY_MS,
        );
        return Math.max(1, Math.min(diffDays, CHART_DAY_LIMIT));
      }
    }
  }

  private buildChangeRate(current: number, previous: number): number | null {
    if (this.isZero(previous)) {
      return null;
    }
    return this.roundMoney(
      new Decimal(current).minus(previous).div(previous).mul(100),
    );
  }

  private calcRate(amount: number, total: number): number {
    if (this.isZero(total)) {
      return 0;
    }
    return this.roundMoney(new Decimal(amount).div(total).mul(100));
  }

  private multiplyMoney(amount: number, quantity: number): number {
    return this.roundMoney(new Decimal(amount).mul(quantity));
  }

  private addMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).plus(right));
  }

  private subtractMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).minus(right));
  }

  private roundMoney(value: Decimal.Value): number {
    return new Decimal(value)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private isZero(value: number): boolean {
    return new Decimal(value).isZero();
  }

  private getDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private getDayEnd(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  private formatMonthDay(timestamp: number): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }
}
