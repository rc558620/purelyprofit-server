import { allocateLineDiscounts } from './club-scan-ordering-cart-pricing.utils';
import type { PricedCartItem } from './club-scan-ordering-order.types';

/** 构造分摊用的购物车行（只用得到 quantity / lineTotalAmount）。 */
const pricedItem = (
  quantity: number,
  lineTotalAmount: number,
): PricedCartItem =>
  ({
    cartItemId: 1,
    productId: 1,
    inventoryProductId: null,
    productName: '测试商品',
    productImageUrl: null,
    categoryName: '测试分类',
    quantity,
    specSignature: 'sig',
    basePrice: lineTotalAmount,
    unitPriceAmount: lineTotalAmount,
    lineTotalAmount,
    specs: [],
  }) as PricedCartItem;

describe('allocateLineDiscounts', () => {
  it('按行金额比例分摊，各行之和精确等于总优惠', () => {
    const items = [pricedItem(1, 3000), pricedItem(2, 7000)];

    expect(allocateLineDiscounts(items, 1000)).toEqual([300, 700]);
  });

  it('除不尽的余数落在末行，总额仍然精确', () => {
    const items = [
      pricedItem(1, 1000),
      pricedItem(1, 1000),
      pricedItem(1, 1000),
    ];

    const result = allocateLineDiscounts(items, 1000);

    expect(result.reduce((sum, value) => sum + value, 0)).toBe(1000);
    expect(result[2]).toBeGreaterThanOrEqual(result[0]);
  });

  it('单行优惠不得超过该行金额（优惠超过行合计时不能出现负行应付）', () => {
    const items = [pricedItem(1, 100), pricedItem(1, 9900)];

    const result = allocateLineDiscounts(items, 9900);

    // 旧实现会把全部 9900 塞给末行前的那一行，导致该行应付被 clamp 成 0
    result.forEach((discount, index) => {
      expect(discount).toBeLessThanOrEqual(items[index].lineTotalAmount);
      expect(discount).toBeGreaterThanOrEqual(0);
    });
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(9900);
  });

  it('行金额合计为 0 时全部分配 0，不把优惠硬塞给某一行', () => {
    const items = [pricedItem(1, 0), pricedItem(1, 0)];

    expect(allocateLineDiscounts(items, 500)).toEqual([0, 0]);
  });

  it('优惠为 0 或负数时不分摊', () => {
    const items = [pricedItem(1, 3000)];

    expect(allocateLineDiscounts(items, 0)).toEqual([0]);
  });

  it('空购物车返回空数组', () => {
    expect(allocateLineDiscounts([], 500)).toEqual([]);
  });
});
