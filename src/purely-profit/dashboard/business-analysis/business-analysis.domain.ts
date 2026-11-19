import { Logger } from '@nestjs/common';
import {
  isGrouponVoucherItemName,
  toOptionalMediaText,
} from '../../commerce/commerce.utils';
import { Money, type MoneyDbCentsInput } from '../../../shared/money.utils';
import { BUSINESS_ANALYSIS_RANK_LIMIT } from './business-analysis.types';
import type {
  AggregatedCategory,
  AggregatedRankProduct,
  BusinessAnalysisCategoryRow,
  BusinessAnalysisCostBucketRow,
  BusinessAnalysisDailyCostRow,
  BusinessAnalysisDailyRevenueRow,
  BusinessAnalysisRankRow,
  BusinessAnalysisRankSort,
  CostAggregationResult,
  CostBucketKey,
  SalesAggregationResult,
} from './business-analysis.types';
import { compareText, getShanghaiDayStartMs } from './business-analysis.utils';

const logger = new Logger('BusinessAnalysisDomain');

/**
 * 安全地将数据库分值转为 Money，null/undefined 视为 0。
 */
function safeDbCents(value: MoneyDbCentsInput | null | undefined): Money {
  if (value === null || value === undefined) {
    return Money.zero();
  }
  return Money.fromDbCents(value);
}

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: Money.zero(),
    totalProfit: Money.zero(),
    goodsCost: Money.zero(),
    orderCount: 0,
    dailyRevenueMap: new Map<number, Money>(),
    dailyProfitMap: new Map<number, Money>(),
    dailyGoodsCostMap: new Map<number, Money>(),
    categoryMap: new Map<string, AggregatedCategory>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

export function createEmptyCostAggregation(): CostAggregationResult {
  return {
    totalCost: Money.zero(),
    dailyCostMap: new Map<number, Money>(),
    costBucketMap: new Map<CostBucketKey, Money>(),
  };
}

export function buildSalesAggregation(input: {
  revenue: number;
  orderCount: number;
  /** 商品利润总和（已扣除商品成本价），单位：分 */
  profit?: number;
  dailyRows?: BusinessAnalysisDailyRevenueRow[];
  categoryRows?: BusinessAnalysisCategoryRow[];
  rankRows?: BusinessAnalysisRankRow[];
}): SalesAggregationResult {
  const result = createEmptySalesAggregation();
  result.revenue = Money.fromDbCents(input.revenue);
  result.totalProfit = safeDbCents(input.profit);
  result.goodsCost = result.revenue.subtract(result.totalProfit);
  result.orderCount = input.orderCount;

  for (const row of input.dailyRows ?? []) {
    const dayStart = getShanghaiDayStartMs(row.bucketAt.getTime());
    const dailyRevenue = safeDbCents(row.revenue);
    const dailyProfit = safeDbCents(row.profit);
    result.dailyRevenueMap.set(dayStart, dailyRevenue);
    result.dailyProfitMap.set(dayStart, dailyProfit);
    result.dailyGoodsCostMap.set(dayStart, dailyRevenue.subtract(dailyProfit));
  }

  for (const row of input.categoryRows ?? []) {
    result.categoryMap.set(row.categoryName, {
      revenue: safeDbCents(row.revenue),
      profit: safeDbCents(row.profit),
      quantity: row.quantity,
    });
  }

  for (const row of input.rankRows ?? []) {
    // 券面消费行是券面金额的记账载体，不是真实商品：进榜会凭空多出一个「商品」。
    // 金额侧（营业额 / 利润 / 日趋势）不在这里处理，SQL 已保留该行。
    if (isGrouponVoucherItemName(row.productName, row.categoryName)) {
      continue;
    }

    const rankKey =
      row.productId !== null
        ? String(row.productId)
        : `snapshot:${row.productName}`;
    const image = toOptionalMediaText(row.image);
    // SQL 按 (product_id, product_name, category_name) 分组，同一商品改名后会
    // 产生多行同 productId 的结果。早期实现直接用 set 覆盖，导致改名商品的
    // 收入/利润/销量被静默丢弃，这里改为按 key 累加聚合。
    // 调用方已按 rankSort 预排序，先出现的分组排序最靠前，名称/分类沿用之。
    const existingRank = result.rankMap.get(rankKey);
    if (existingRank) {
      existingRank.totalRevenue = existingRank.totalRevenue.add(
        safeDbCents(row.totalRevenue),
      );
      existingRank.totalProfit = existingRank.totalProfit.add(
        safeDbCents(row.totalProfit),
      );
      existingRank.quantity += row.quantity;
      if (!existingRank.image && image) {
        existingRank.image = image;
      }
      continue;
    }

    result.rankMap.set(rankKey, {
      id: rankKey,
      name: row.productName,
      category: row.categoryName,
      totalRevenue: safeDbCents(row.totalRevenue),
      totalProfit: safeDbCents(row.totalProfit),
      quantity: row.quantity,
      ...(image ? { image } : {}),
    });
  }

  return result;
}

/** 排行排序口径：与 query.helpers.compareRankRows 的三种维度严格一致（金额按分比较）。 */
function compareRankProducts(
  a: AggregatedRankProduct,
  b: AggregatedRankProduct,
  rankSort: BusinessAnalysisRankSort,
): number {
  const aProfit = a.totalProfit.toDbCents();
  const bProfit = b.totalProfit.toDbCents();
  const aRevenue = a.totalRevenue.toDbCents();
  const bRevenue = b.totalRevenue.toDbCents();

  switch (rankSort) {
    case 'revenue':
      return (
        bRevenue - aRevenue || bProfit - aProfit || compareText(a.name, b.name)
      );
    case 'quantity':
      return (
        b.quantity - a.quantity ||
        bProfit - aProfit ||
        compareText(a.name, b.name)
      );
    default:
      return (
        bProfit - aProfit || bRevenue - aRevenue || compareText(a.name, b.name)
      );
  }
}

/**
 * 按 productId 合并**之后**再排序、截断。
 *
 * 早期实现在 SQL 分组阶段就 LIMIT：同一商品改名/改分类会拆成多行，各自的
 * 利润都低于截断线时会被整段切掉（合并后本应进榜甚至第一），或合并后的名次
 * 与展示顺序错位。这里统一改为「先合并、再排序、后截断」。
 */
export function sortAndLimitRankMap(
  rankMap: Map<string, AggregatedRankProduct>,
  rankSort: BusinessAnalysisRankSort,
): Map<string, AggregatedRankProduct> {
  const sorted = Array.from(rankMap.values()).sort((a, b) =>
    compareRankProducts(a, b, rankSort),
  );
  const limited = sorted.slice(0, BUSINESS_ANALYSIS_RANK_LIMIT);
  return new Map(limited.map((item) => [item.id, item]));
}

/** 原地替换聚合结果中的排行 Map，保证 mapper 按最终顺序读取。 */
export function applyRankSort(
  result: SalesAggregationResult,
  rankSort: BusinessAnalysisRankSort,
): SalesAggregationResult {
  result.rankMap = sortAndLimitRankMap(result.rankMap, rankSort);
  return result;
}

export function buildCostAggregation(input: {
  totalCost: number;
  dailyRows?: BusinessAnalysisDailyCostRow[];
  bucketRows?: BusinessAnalysisCostBucketRow[];
}): CostAggregationResult {
  const result = createEmptyCostAggregation();
  result.totalCost = Money.fromDbCents(input.totalCost);

  for (const row of input.dailyRows ?? []) {
    result.dailyCostMap.set(
      getShanghaiDayStartMs(row.bucketAt.getTime()),
      safeDbCents(row.amount),
    );
  }

  for (const row of input.bucketRows ?? []) {
    const bucket = mapCostBucket(row.category);
    result.costBucketMap.set(
      bucket,
      (result.costBucketMap.get(bucket) ?? Money.zero()).add(
        safeDbCents(row.amount),
      ),
    );
  }

  return result;
}

const KNOWN_COST_CATEGORIES = new Set([
  'purchase',
  'salary',
  'insurance',
  'provident_fund',
  'rent',
  'utilities',
  'marketing',
  'equipment',
  'packaging',
  'other',
]);

export function mapCostBucket(category: string): CostBucketKey {
  switch (category) {
    case 'purchase':
      return 'purchase';
    case 'salary':
    case 'insurance':
    case 'provident_fund':
      return 'salary';
    case 'rent':
      return 'rent';
    case 'utilities':
      return 'utilities';
    case 'marketing':
      return 'marketing';
    case 'equipment':
    case 'packaging':
    case 'other':
      return 'other';
    default:
      // 未知成本类型静默归入 other，但打印告警日志便于排查新增类型
      if (!KNOWN_COST_CATEGORIES.has(category)) {
        logger.warn(
          `[business-analysis] 未知成本类型 "${category}"，已归入「其他」，请确认是否需要新增分类`,
        );
      }
      return 'other';
  }
}
