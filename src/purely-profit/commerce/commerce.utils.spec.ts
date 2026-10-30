// 净额还原与券面行判定：小票「合计」与整单退款依赖的口径
import {
  isGrouponVoucherItemName,
  isNonQuantitySalesRecordRow,
  sumNetPayableCents,
  sumNetProfitCents,
} from './commerce.utils';

/** 明细行夹具：salePrice / profit 与库里一致，单位为分 */
const buildItem = (
  productName: string,
  salePrice: number,
  profit = salePrice,
  quantity = 1,
  categoryName = '饮品',
) => ({ productName, salePrice, profit, quantity, categoryName });

describe('sumNetPayableCents', () => {
  it('无抵扣行的普通订单 → 等于明细金额之和', () => {
    const total = sumNetPayableCents([
      buildItem('橙汁', 1500, 600),
      buildItem('薯条', 750, 200, 2),
    ]);
    expect(total).toBe(1500 + 750 * 2);
  });

  it('抵扣行按绝对值扣减，不重复计入', () => {
    const total = sumNetPayableCents([
      buildItem('分手大师（团购券）', 18870, 18870, 1, '团购券'),
      buildItem('橙汁', 8800, 4000),
      buildItem('预付款', 18870, 18870, 1, '场地费'),
    ]);
    // 券面计入消费、预付款等额冲抵 → 客人只付点单的 88 元
    expect(total).toBe(8800);
  });

  it('抵扣行以负数存储时结果一致（手工录单口径）', () => {
    const total = sumNetPayableCents([
      buildItem('橙汁', 8800),
      buildItem('续费抵扣', -3000),
    ]);
    expect(total).toBe(5800);
  });

  it('抵扣额大于消费时可以为负（保留既有「应退」语义）', () => {
    const total = sumNetPayableCents([
      buildItem('台位费 1分钟', 10000, 10000, 1, '场地费'),
      buildItem('预付款', 18870, 18870, 1, '场地费'),
    ]);
    expect(total).toBe(-8870);
  });

  it('空明细 → 0', () => {
    expect(sumNetPayableCents([])).toBe(0);
  });
});

describe('sumNetProfitCents', () => {
  it('与净额同口径扣减抵扣行利润', () => {
    const profit = sumNetProfitCents([
      buildItem('分手大师（团购券）', 18870, 18870, 1, '团购券'),
      buildItem('橙汁', 8800, 4000),
      buildItem('预付款', 18870, 18870, 1, '场地费'),
    ]);
    expect(profit).toBe(4000);
  });
});

describe('isGrouponVoucherItemName', () => {
  it('系统券面行（后缀 + 分类）→ true', () => {
    expect(isGrouponVoucherItemName('分手大师（团购券）', '团购券')).toBe(true);
  });

  it('商家自建商品恰以「（团购券）」结尾 → false，避免销量/排行榜漏统计', () => {
    expect(isGrouponVoucherItemName('周末特惠（团购券）', '饮品')).toBe(false);
  });

  it('不传分类时退化为按后缀判定（历史调用点兼容）', () => {
    expect(isGrouponVoucherItemName('分手大师（团购券）')).toBe(true);
  });

  it('非券面行 → false', () => {
    expect(isGrouponVoucherItemName('橙汁', '饮品')).toBe(false);
  });
});

describe('isNonQuantitySalesRecordRow', () => {
  it('券面行不计件数', () => {
    expect(isNonQuantitySalesRecordRow('分手大师（团购券）', '团购券')).toBe(
      true,
    );
  });

  it('同名商家商品仍计入件数', () => {
    expect(isNonQuantitySalesRecordRow('周末特惠（团购券）', '饮品')).toBe(
      false,
    );
  });

  it('抵扣行与台位费行判定不受影响', () => {
    expect(isNonQuantitySalesRecordRow('预付款', '场地费')).toBe(true);
    expect(isNonQuantitySalesRecordRow('台位费 1分钟', '场地费')).toBe(true);
    expect(isNonQuantitySalesRecordRow('橙汁', '饮品')).toBe(false);
  });
});
