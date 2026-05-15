import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { FinanceCashFlowCategory, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import {
  toDecimalNumber,
  toOptionalMediaText,
} from '../commerce/commerce.utils';
import { PrismaService } from '../prisma/prisma.service';
import {
  GetBusinessAnalysisQueryDto,
  type BusinessAnalysisPeriod,
} from './dto/business-analysis-query.dto';
import type {
  BusinessAnalysisCategoryShareDto,
  BusinessAnalysisCompareDataDto,
  BusinessAnalysisCostRateItemDto,
  BusinessAnalysisDailyTrendDto,
  BusinessAnalysisRankProductDto,
  BusinessAnalysisResponseDto,
} from './dto/business-analysis-response.dto';

const DAY_MS = 86_400_000;
const MAX_TREND_DAYS = 90;

const COST_CATEGORY_META = {
  purchase: { label: '进货成本', color: '#f97316' },
  salary: { label: '人力成本', color: '#3b82f6' },
  rent: { label: '租金', color: '#8b5cf6' },
  utilities: { label: '水电费', color: '#06b6d4' },
  marketing: { label: '营销', color: '#ec4899' },
  other: { label: '其他', color: '#94a3b8' },
} as const;

type CostBucketKey = keyof typeof COST_CATEGORY_META;

type SaleOrderItemRow = {
  productId: number | null;
  productName: string;
  categoryName: string;
  salePrice: Prisma.Decimal;
  profit: Prisma.Decimal;
  quantity: number;
  image: string | null;
  createdAt: Date;
  order: {
    id: number;
    date: Date;
  };
};

type CashFlowCostRow = {
  category: FinanceCashFlowCategory;
  amount: Prisma.Decimal;
  date: Date;
};

interface AggregatedCategory {
  revenue: number;
  profit: number;
  quantity: number;
}

interface AggregatedRankProduct {
  id: string;
  name: string;
  category: string;
  totalProfit: number;
  totalRevenue: number;
  quantity: number;
  image?: string;
}

interface SalesAggregationResult {
  revenue: number;
  orderCount: number;
  dailyRevenueMap: Map<number, number>;
  categoryMap: Map<string, AggregatedCategory>;
  rankMap: Map<string, AggregatedRankProduct>;
}

interface CostAggregationResult {
  totalCost: number;
  dailyCostMap: Map<number, number>;
  costBucketMap: Map<CostBucketKey, number>;
}

interface BusinessAnalysisRange {
  start: number;
  end: number;
}

@Injectable()
export class BusinessAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getAnalysis(
    user: AuthenticatedUser,
    query: GetBusinessAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    const currentRange = this.resolveCurrentRange(query);

    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店经营分析',
    );

    const previousRange = this.getPreviousRange(
      currentRange.start,
      currentRange.end,
    );

    const [saleItems, costRows] = await Promise.all([
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId,
          order: {
            date: {
              gte: new Date(previousRange.start),
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
          createdAt: true,
          order: {
            select: {
              id: true,
              date: true,
            },
          },
        },
        orderBy: [{ order: { date: 'asc' } }, { id: 'asc' }],
      }),
      this.prisma.financeCashFlowRecord.findMany({
        where: {
          storeId,
          direction: 'expense',
          date: {
            gte: new Date(previousRange.start),
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
      saleItems,
      currentRange.start,
      currentRange.end,
    );
    const previousSales = this.aggregateSales(
      saleItems,
      previousRange.start,
      previousRange.end,
    );
    const currentCosts = this.aggregateCosts(
      costRows,
      currentRange.start,
      currentRange.end,
    );
    const previousCosts = this.aggregateCosts(
      costRows,
      previousRange.start,
      previousRange.end,
    );

    const currentProfit = this.subtractMoney(
      currentSales.revenue,
      currentCosts.totalCost,
    );
    const previousProfit = this.subtractMoney(
      previousSales.revenue,
      previousCosts.totalCost,
    );
    const currentProfitRate = this.calcRate(
      currentProfit,
      currentSales.revenue,
    );
    const previousProfitRate = this.calcRate(
      previousProfit,
      previousSales.revenue,
    );

    return {
      heroSummary: {
        netProfit: this.buildCompare(currentProfit, previousProfit),
        revenue: this.buildCompare(currentSales.revenue, previousSales.revenue),
        totalCost: this.buildCompare(
          currentCosts.totalCost,
          previousCosts.totalCost,
        ),
        profitRate: {
          current: currentProfitRate,
          previous: previousProfitRate,
          changeRate: this.subtractMoney(currentProfitRate, previousProfitRate),
        },
        orderCount: currentSales.orderCount,
      },
      dailyTrend: this.buildDailyTrend(
        currentRange.start,
        currentRange.end,
        currentSales.dailyRevenueMap,
        currentCosts.dailyCostMap,
      ),
      categoryShares: this.buildCategoryShares(
        currentSales.categoryMap,
        currentSales.revenue,
      ),
      costRateItems: this.buildCostRateItems(
        currentCosts.costBucketMap,
        currentCosts.totalCost,
      ),
      rankProducts: this.buildRankProducts(currentSales.rankMap),
    };
  }

  private resolveCurrentRange(
    query: GetBusinessAnalysisQueryDto,
  ): BusinessAnalysisRange {
    const now = Date.now();

    if (query.period === 'custom_month' || query.period === 'custom_range') {
      if (query.startTime === undefined || query.endTime === undefined) {
        throw new BadRequestException('自定义周期必须传开始和结束时间');
      }

      if (query.endTime < query.startTime) {
        throw new BadRequestException('结束时间不能早于开始时间');
      }

      return {
        start: query.startTime,
        end: query.endTime,
      };
    }

    return this.resolvePresetRange(query.period, now);
  }

  private resolvePresetRange(
    period: Exclude<BusinessAnalysisPeriod, 'custom_month' | 'custom_range'>,
    now: number,
  ): BusinessAnalysisRange {
    switch (period) {
      case 'today':
        return { start: this.getDayStart(now), end: now };
      case 'week':
        return { start: this.getWeekStart(now), end: now };
      case 'month':
        return { start: this.getMonthStart(now), end: now };
      case 'quarter':
        return { start: this.getQuarterStart(now), end: now };
      case 'all':
      default:
        return { start: 0, end: now };
    }
  }

  private getPreviousRange(
    start: number,
    end: number,
  ): BusinessAnalysisRange {
    const duration = end - start;
    return {
      start: start - duration - 1,
      end: start - 1,
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
    const categoryMap = new Map<string, AggregatedCategory>();
    const rankMap = new Map<string, AggregatedRankProduct>();

    for (const row of rows) {
      const orderTimestamp = row.order.date.getTime();
      if (orderTimestamp < start || orderTimestamp > end) {
        continue;
      }

      const itemRevenue = this.multiplyMoney(
        toDecimalNumber(row.salePrice),
        row.quantity,
      );
      const itemProfit = this.multiplyMoney(
        toDecimalNumber(row.profit),
        row.quantity,
      );
      revenue = this.addMoney(revenue, itemRevenue);
      orderCount += 1;

      const dayStart = this.getDayStart(orderTimestamp);
      dailyRevenueMap.set(
        dayStart,
        this.addMoney(dailyRevenueMap.get(dayStart) ?? 0, itemRevenue),
      );

      const currentCategory = categoryMap.get(row.categoryName);
      if (currentCategory) {
        currentCategory.revenue = this.addMoney(
          currentCategory.revenue,
          itemRevenue,
        );
        currentCategory.profit = this.addMoney(
          currentCategory.profit,
          itemProfit,
        );
        currentCategory.quantity += row.quantity;
      } else {
        categoryMap.set(row.categoryName, {
          revenue: itemRevenue,
          profit: itemProfit,
          quantity: row.quantity,
        });
      }

      const rankKey =
        row.productId !== null
          ? String(row.productId)
          : `snapshot:${row.productName}`;
      const currentProduct = rankMap.get(rankKey);
      if (currentProduct) {
        currentProduct.totalRevenue = this.addMoney(
          currentProduct.totalRevenue,
          itemRevenue,
        );
        currentProduct.totalProfit = this.addMoney(
          currentProduct.totalProfit,
          itemProfit,
        );
        currentProduct.quantity += row.quantity;
        if (!currentProduct.image && row.image) {
          currentProduct.image = row.image;
        }
      } else {
        rankMap.set(rankKey, {
          id: rankKey,
          name: row.productName,
          category: row.categoryName,
          totalRevenue: itemRevenue,
          totalProfit: itemProfit,
          quantity: row.quantity,
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
      categoryMap,
      rankMap,
    };
  }

  private aggregateCosts(
    rows: CashFlowCostRow[],
    start: number,
    end: number,
  ): CostAggregationResult {
    let totalCost = 0;
    const dailyCostMap = new Map<number, number>();
    const costBucketMap = new Map<CostBucketKey, number>();

    for (const row of rows) {
      const timestamp = row.date.getTime();
      if (timestamp < start || timestamp > end) {
        continue;
      }

      const bucket = this.mapCostBucket(row.category);
      const amount = toDecimalNumber(row.amount);
      totalCost = this.addMoney(totalCost, amount);

      const dayStart = this.getDayStart(timestamp);
      dailyCostMap.set(
        dayStart,
        this.addMoney(dailyCostMap.get(dayStart) ?? 0, amount),
      );
      costBucketMap.set(
        bucket,
        this.addMoney(costBucketMap.get(bucket) ?? 0, amount),
      );
    }

    return {
      totalCost,
      dailyCostMap,
      costBucketMap,
    };
  }

  private buildDailyTrend(
    start: number,
    end: number,
    dailyRevenueMap: Map<number, number>,
    dailyCostMap: Map<number, number>,
  ): BusinessAnalysisDailyTrendDto[] {
    const days = Math.max(
      1,
      Math.min(MAX_TREND_DAYS, Math.round((end - start) / DAY_MS) + 1),
    );
    const endDate = new Date(end);
    const items: BusinessAnalysisDailyTrendDto[] = [];

    for (let offset = 0; offset < days; offset += 1) {
      const currentDate = new Date(endDate);
      currentDate.setDate(endDate.getDate() - (days - 1 - offset));
      const currentDay = this.getDayStart(currentDate.getTime());
      const revenue = dailyRevenueMap.get(currentDay) ?? 0;
      const cost = dailyCostMap.get(currentDay) ?? 0;
      items.push({
        dateLabel: this.formatMonthDay(currentDay),
        revenue,
        cost,
        profit: this.subtractMoney(revenue, cost),
      });
    }

    return items;
  }

  private buildCategoryShares(
    categoryMap: Map<string, AggregatedCategory>,
    totalRevenue: number,
  ): BusinessAnalysisCategoryShareDto[] {
    return Array.from(categoryMap.entries())
      .map(([name, value]) => ({
        name,
        revenue: value.revenue,
        profit: value.profit,
        profitRate: this.calcRate(value.profit, value.revenue),
        quantity: value.quantity,
        revenueShare: this.calcRate(value.revenue, totalRevenue),
      }))
      .sort((left, right) => right.revenue - left.revenue);
  }

  private buildCostRateItems(
    bucketMap: Map<CostBucketKey, number>,
    totalCost: number,
  ): BusinessAnalysisCostRateItemDto[] {
    return Array.from(bucketMap.entries())
      .map(([bucket, amount]) => ({
        label: COST_CATEGORY_META[bucket].label,
        amount,
        percentage: this.calcRate(amount, totalCost),
        color: COST_CATEGORY_META[bucket].color,
      }))
      .sort((left, right) => right.amount - left.amount);
  }

  private buildRankProducts(
    rankMap: Map<string, AggregatedRankProduct>,
  ): BusinessAnalysisRankProductDto[] {
    return Array.from(rankMap.values())
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        profitRate: this.calcRate(item.totalProfit, item.totalRevenue),
        totalProfit: item.totalProfit,
        totalRevenue: item.totalRevenue,
        quantity: item.quantity,
        ...(item.image ? { image: item.image } : {}),
      }))
      .sort((left, right) => right.totalProfit - left.totalProfit);
  }

  private mapCostBucket(category: FinanceCashFlowCategory | string): CostBucketKey {
    switch (category) {
      case 'purchase':
        return 'purchase';
      case 'salary':
        return 'salary';
      case 'rent':
        return 'rent';
      case 'utilities':
        return 'utilities';
      case 'marketing':
        return 'marketing';
      case 'sales':
      case 'refund':
      case 'transfer_in':
      case 'other_income':
      case 'tax':
      case 'transfer_out':
      case 'other_expense':
      default:
        return 'other';
    }
  }

  private buildCompare(
    current: number,
    previous: number,
  ): BusinessAnalysisCompareDataDto {
    return {
      current,
      previous,
      changeRate: this.isZero(previous)
        ? null
        : this.roundMoney(
            new Decimal(current).minus(previous).div(previous).mul(100),
          ),
    };
  }

  private calcRate(amount: number, total: number): number {
    if (this.isZero(total)) {
      return 0;
    }
    return this.roundMoney(new Decimal(amount).div(total).mul(100));
  }

  private multiplyMoney(left: number, quantity: number): number {
    return this.roundMoney(new Decimal(left).mul(quantity));
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

  private getWeekStart(timestamp: number): number {
    const date = new Date(timestamp);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private getMonthStart(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }

  private getQuarterStart(timestamp: number): number {
    const date = new Date(timestamp);
    const quarter = Math.floor(date.getMonth() / 3);
    return new Date(date.getFullYear(), quarter * 3, 1).getTime();
  }

  private formatMonthDay(timestamp: number): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }
}
