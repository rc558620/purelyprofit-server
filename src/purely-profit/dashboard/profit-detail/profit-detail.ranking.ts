import { calcPercentOfTotal } from '../../commerce/commerce.utils';
import type { ProductRankItemDto } from './dto/profit-detail-response.dto';
import type { AggregatedRankProduct } from './profit-detail.types';

/** 每个维度下发的条数上限 */
const PRODUCT_RANKING_LIMIT = 5;

type RankMetric = 'profit' | 'revenue' | 'quantity';

function toProductRankItem(item: AggregatedRankProduct): ProductRankItemDto {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price.toOutputYuan(),
    profitPerUnit: item.profitPerUnit.toOutputYuan(),
    quantity: item.quantity,
    totalProfit: item.totalProfit.toOutputYuan(),
    totalRevenue: item.totalRevenue.toOutputYuan(),
    profitRate: calcPercentOfTotal(
      item.totalProfit.toOutputYuan(),
      item.totalRevenue.toOutputYuan(),
    ),
    ...(item.image ? { image: item.image } : {}),
  };
}

/** 排序按「分 / 件」的整数口径比较，避免先转元再相减引入浮点误差 */
function pickMetricValue(
  item: AggregatedRankProduct,
  metric: RankMetric,
): number {
  if (metric === 'revenue') {
    return item.totalRevenue.toDbCents();
  }
  if (metric === 'quantity') {
    return item.quantity;
  }
  return item.totalProfit.toDbCents();
}

/**
 * 三个维度各自取 Top N。
 *
 * 此前只按利润截断 Top 5、再由前端对这 5 条重排，导致「收入第一但利润第六」的
 * 商品在收入 / 销量榜里永远看不到，不是真正的全量 Top 5。现在三个维度分别计算，
 * 前端只负责切换展示。
 */
function buildRankingByMetric(
  rankMap: Map<string, AggregatedRankProduct>,
  metric: RankMetric,
): ProductRankItemDto[] {
  return Array.from(rankMap.values())
    .sort(
      (left, right) =>
        pickMetricValue(right, metric) - pickMetricValue(left, metric),
    )
    .slice(0, PRODUCT_RANKING_LIMIT)
    .map(toProductRankItem);
}

/** 商品利润排行（默认维度，保持既有字段语义） */
export function buildProductRanking(
  rankMap: Map<string, AggregatedRankProduct>,
): ProductRankItemDto[] {
  return buildRankingByMetric(rankMap, 'profit');
}

export function buildProductRankingByRevenue(
  rankMap: Map<string, AggregatedRankProduct>,
): ProductRankItemDto[] {
  return buildRankingByMetric(rankMap, 'revenue');
}

export function buildProductRankingByQuantity(
  rankMap: Map<string, AggregatedRankProduct>,
): ProductRankItemDto[] {
  return buildRankingByMetric(rankMap, 'quantity');
}
