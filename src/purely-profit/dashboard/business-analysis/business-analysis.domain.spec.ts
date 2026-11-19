import {
  applyRankSort,
  buildSalesAggregation,
  sortAndLimitRankMap,
} from './business-analysis.domain';
import type { BusinessAnalysisRankRow } from './business-analysis.types';
import { BUSINESS_ANALYSIS_RANK_LIMIT } from './business-analysis.types';

function buildRankRow(
  overrides: Partial<BusinessAnalysisRankRow> = {},
): BusinessAnalysisRankRow {
  return {
    productId: 1,
    productName: '商品',
    categoryName: '饮品',
    totalRevenue: 10000,
    totalProfit: 6000,
    quantity: 1,
    image: null,
    ...overrides,
  };
}

const toRankView = (
  rankMap: ReturnType<typeof sortAndLimitRankMap>,
): Array<{ id: string; name: string; profit: number }> =>
  Array.from(rankMap.values()).map((item) => ({
    id: item.id,
    name: item.name,
    profit: item.totalProfit.toOutputYuan(),
  }));

describe('business-analysis.domain 排行口径', () => {
  it('同一商品改名后先按 productId 合并，再按合并后的利润排序', () => {
    // 与 query 层一致：入参已按 rankSort 预排序，先出现的分组沿用其名称
    const result = applyRankSort(
      buildSalesAggregation({
        revenue: 0,
        orderCount: 0,
        rankRows: [
          buildRankRow({
            productId: 2,
            productName: '对手',
            totalProfit: 10000,
          }),
          buildRankRow({
            productId: 1,
            productName: '旧名',
            totalProfit: 6000,
          }),
          buildRankRow({
            productId: 1,
            productName: '新名',
            totalProfit: 6000,
          }),
        ],
      }),
      'profit',
    );

    expect(toRankView(result.rankMap)).toEqual([
      { id: '1', name: '旧名', profit: 120 },
      { id: '2', name: '对手', profit: 100 },
    ]);
  });

  it('截断发生在合并之后：改名商品合并后的合计值不会被切掉', () => {
    // 100 个单品各利润 1 分 + 一个改名商品两行各 1 分（合并后 2 分，应排第一）。
    // 若在合并前按行截断，改名商品的两行都会落在截断线外而整段消失。
    const rankRows: BusinessAnalysisRankRow[] = [
      buildRankRow({
        productId: 1,
        productName: '旧名',
        totalProfit: 1,
        totalRevenue: 1,
        quantity: 1,
      }),
      buildRankRow({
        productId: 1,
        productName: '新名',
        totalProfit: 1,
        totalRevenue: 1,
        quantity: 1,
      }),
      ...Array.from({ length: BUSINESS_ANALYSIS_RANK_LIMIT }, (_, index) =>
        buildRankRow({
          productId: 1000 + index,
          productName: `商品${String(index).padStart(3, '0')}`,
          totalProfit: 1,
          totalRevenue: 1,
          quantity: 1,
        }),
      ),
    ];

    const result = applyRankSort(
      buildSalesAggregation({ revenue: 0, orderCount: 0, rankRows }),
      'profit',
    );
    const rankView = toRankView(result.rankMap);

    expect(rankView).toHaveLength(BUSINESS_ANALYSIS_RANK_LIMIT);
    expect(rankView[0]).toEqual({ id: '1', name: '旧名', profit: 0.02 });
    // 合并后共 101 个商品，截断只允许丢掉排序最末的一个
    expect(rankView.some((item) => item.id === '1')).toBe(true);
    expect(rankView.filter((item) => item.id !== '1')).toHaveLength(
      BUSINESS_ANALYSIS_RANK_LIMIT - 1,
    );
  });

  it('券面消费行不进排行，但商家自建的「（团购券）」结尾商品仍保留', () => {
    const result = buildSalesAggregation({
      revenue: 0,
      orderCount: 0,
      rankRows: [
        buildRankRow({
          productId: null,
          productName: '分手大师（团购券）',
          categoryName: '团购券',
          totalRevenue: 18870,
          totalProfit: 10870,
        }),
        buildRankRow({
          productId: 3,
          productName: '张三招牌（团购券）',
          categoryName: '招牌套餐',
          totalRevenue: 18870,
          totalProfit: 10000,
        }),
        buildRankRow({
          productId: 4,
          productName: '橙汁',
          categoryName: '饮品',
        }),
      ],
    });

    expect(Array.from(result.rankMap.keys())).toEqual(['3', '4']);
  });

  it('按销量 / 收入排序时同样使用合并后的合计值', () => {
    const rankRows: BusinessAnalysisRankRow[] = [
      buildRankRow({
        productId: 1,
        productName: '多次改名',
        totalRevenue: 6000,
        totalProfit: 3000,
        quantity: 6,
      }),
      buildRankRow({
        productId: 1,
        productName: '多次改名（新）',
        totalRevenue: 6000,
        totalProfit: 3000,
        quantity: 6,
      }),
      buildRankRow({
        productId: 2,
        productName: '大单',
        totalRevenue: 20000,
        totalProfit: 1000,
        quantity: 2,
      }),
    ];

    const byRevenue = applyRankSort(
      buildSalesAggregation({ revenue: 0, orderCount: 0, rankRows }),
      'revenue',
    );
    const byQuantity = applyRankSort(
      buildSalesAggregation({ revenue: 0, orderCount: 0, rankRows }),
      'quantity',
    );

    expect(Array.from(byRevenue.rankMap.keys())).toEqual(['2', '1']);
    expect(Array.from(byQuantity.rankMap.keys())).toEqual(['1', '2']);
  });
});
