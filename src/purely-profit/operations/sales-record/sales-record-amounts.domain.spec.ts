import { describe, it, expect } from '@jest/globals';
import { Money } from '../../../shared/money.utils';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';

describe('SalesRecordAmountsDomain', () => {
  describe('aggregateFromPreparedItems', () => {
    it('应该正确聚合单个商品项的金额', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(6.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
      ];

      const result = SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].subtotal).toBe(13); // 6.5 * 2
      expect(result.items[0].profitSubtotal).toBe(5); // 2.5 * 2
      expect(result.totalRevenue).toBe(13);
      expect(result.totalProfit).toBe(5);
      expect(result.totalQuantity).toBe(2);
    });

    it('应该正确聚合多个商品项的金额', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(6.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
        {
          productId: 2,
          productName: '薯条',
          categoryName: '快餐',
          salePrice: Money.fromInputYuan(12),
          profit: Money.fromInputYuan(4),
          quantity: 1,
          countsTowardTotalQuantity: true,
        },
      ];

      const result = SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      expect(result.items).toHaveLength(2);
      expect(result.totalRevenue).toBe(25); // 13 + 12
      expect(result.totalProfit).toBe(9); // 5 + 4
      expect(result.totalQuantity).toBe(3); // 2 + 1
    });

    it('应该排除 countsTowardTotalQuantity=false 的抵扣项（默认 excludeDeductionItems=true）', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(6.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
        {
          productId: null,
          productName: '预付款',
          categoryName: '抵扣',
          salePrice: Money.fromInputYuan(-10),
          profit: Money.fromInputYuan(-3),
          quantity: 1,
          countsTowardTotalQuantity: false, // 不计入任何统计（被排除）
        },
      ];

      const result = SalesRecordAmountsDomain.aggregateFromPreparedItems(
        items,
        {
          excludeDeductionItems: true, // 默认行为
        },
      );

      expect(result.totalQuantity).toBe(2); // 只算第一项的 2 件
      expect(result.totalRevenue).toBe(13); // 只计算可口可乐：6.5 * 2
      expect(result.totalProfit).toBe(5); // 只计算可口可乐的利润：2.5 * 2
    });

    it('应该正确处理多个不同商品的聚合', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(6.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
        {
          productId: 2,
          productName: '薯条',
          categoryName: '快餐',
          salePrice: Money.fromInputYuan(8.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 3,
          countsTowardTotalQuantity: true,
        },
      ];

      const result = SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      expect(result.items).toHaveLength(2);
      expect(result.totalQuantity).toBe(5); // 2 + 3
      expect(result.totalRevenue).toBeCloseTo(38.5, 2); // (6.5 * 2) + (8.5 * 3) = 13 + 25.5
      expect(result.totalProfit).toBeCloseTo(12.5, 2); // (2.5 * 2) + (2.5 * 3) = 5 + 7.5
    });

    it('应该处理负数和小数精度', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '优惠商品',
          categoryName: '促销',
          salePrice: Money.fromInputYuan(9.99),
          profit: Money.fromInputYuan(1.99),
          quantity: 3,
          countsTowardTotalQuantity: true,
        },
      ];

      const result = SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      expect(result.items[0].subtotal).toBeCloseTo(29.97, 2); // 9.99 * 3
      expect(result.items[0].profitSubtotal).toBeCloseTo(5.97, 2); // 1.99 * 3
      expect(result.totalRevenue).toBeCloseTo(29.97, 2);
      expect(result.totalProfit).toBeCloseTo(5.97, 2);
    });

    it('应该通过一致性断言验证', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(6.5),
          profit: Money.fromInputYuan(2.5),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
        {
          productId: 2,
          productName: '薯条',
          categoryName: '快餐',
          salePrice: Money.fromInputYuan(12),
          profit: Money.fromInputYuan(4),
          quantity: 1,
          countsTowardTotalQuantity: true,
        },
      ];

      const snapshot =
        SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      // 不应该抛出错误
      expect(() =>
        SalesRecordAmountsDomain.assertConsistency(snapshot),
      ).not.toThrow();
    });

    it('金额快照应该支持客户端展示（不再本地计算）', () => {
      const items: PreparedSalesItem[] = [
        {
          productId: 1,
          productName: '咖啡',
          categoryName: '饮品',
          salePrice: Money.fromInputYuan(15.8),
          profit: Money.fromInputYuan(5.2),
          quantity: 2,
          countsTowardTotalQuantity: true,
        },
      ];

      const snapshot =
        SalesRecordAmountsDomain.aggregateFromPreparedItems(items);

      // 前端可以直接使用这些值展示，无需再做任何计算
      const itemData = snapshot.items[0];
      expect(itemData.salePrice).toBe(15.8);
      expect(itemData.quantity).toBe(2);
      expect(itemData.subtotal).toBe(31.6); // 前端 OK: 已由后端计算
      expect(itemData.profitSubtotal).toBe(10.4);

      // 汇总数据也已由后端计算
      expect(snapshot.totalRevenue).toBe(31.6);
      expect(snapshot.totalProfit).toBe(10.4);
      expect(snapshot.totalQuantity).toBe(2);
    });
  });
});
