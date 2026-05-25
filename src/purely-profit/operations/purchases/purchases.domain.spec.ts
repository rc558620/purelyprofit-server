import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  assertPurchaseSupplierInput,
  buildPurchaseCostTitle,
  buildPurchaseListWhere,
  calculatePurchaseCompareLastMonth,
  createPurchaseProductMap,
  extractUniqueProductIds,
  normalizePurchaseNote,
  normalizePurchaseSupplierName,
  preparePurchaseItems,
  resolvePurchaseStatsRanges,
  sumPreparedPurchaseAmount,
} from './purchases.domain';
import type { PurchaseProductRecord } from './purchases.types';

describe('purchases.domain', () => {
  const products: PurchaseProductRecord[] = [
    { id: 201, name: '可口可乐 330ml', unit: '瓶' },
    { id: 202, name: '雪碧', unit: '瓶' },
  ];

  it('buildPurchaseListWhere 会拼出门店和自定义日期范围条件', () => {
    const rangeStartDate = 1715558400000;
    const rangeEndDate = 1715644799999;
    const expectedStart = new Date(rangeStartDate);
    expectedStart.setHours(0, 0, 0, 0);
    const expectedEnd = new Date(rangeEndDate);
    expectedEnd.setHours(23, 59, 59, 999);

    const where = buildPurchaseListWhere(18, {
      period: 'custom_range',
      rangeStartDate,
      rangeEndDate,
    });

    expect(where).toEqual({
      storeId: 18,
      date: {
        gte: expectedStart,
        lte: expectedEnd,
      },
    });
  });

  it('resolvePurchaseStatsRanges 会生成当前区间和上一期区间', () => {
    const rangeStartDate = 1715558400000;
    const rangeEndDate = 1715644799999;
    const expectedStart = new Date(rangeStartDate);
    expectedStart.setHours(0, 0, 0, 0);
    const expectedEnd = new Date(rangeEndDate);
    expectedEnd.setHours(23, 59, 59, 999);
    const duration = expectedEnd.getTime() - expectedStart.getTime();

    const result = resolvePurchaseStatsRanges(18, {
      period: 'custom_range',
      rangeStartDate,
      rangeEndDate,
    });

    expect(result.currentWhere).toEqual({
      storeId: 18,
      date: {
        gte: expectedStart,
        lte: expectedEnd,
      },
    });
    expect(result.previousRange).toEqual({
      gte: new Date(expectedStart.getTime() - duration - 1),
      lte: new Date(expectedStart.getTime() - 1),
    });
  });

  it('normalizePurchaseSupplierName 和 normalizePurchaseNote 会去空白并返回 null', () => {
    expect(normalizePurchaseSupplierName('  临时供应商  ')).toBe('临时供应商');
    expect(normalizePurchaseSupplierName('   ')).toBeNull();
    expect(normalizePurchaseNote('  月结  ')).toBe('月结');
    expect(normalizePurchaseNote(undefined)).toBeNull();
  });

  it('assertPurchaseSupplierInput 在 supplierId 和 supplierName 都缺失时抛错', () => {
    expect(() => assertPurchaseSupplierInput(undefined, null)).toThrow(
      BadRequestException,
    );
  });

  it('extractUniqueProductIds 会提取唯一商品 ID 并忽略无码商品', () => {
    expect(
      extractUniqueProductIds([
        { productId: 201, quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 8, productName: '散装辣条' },
        { productId: 202, quantity: 3, unitPrice: 9 },
      ]),
    ).toEqual([201, 202]);
  });

  it('extractUniqueProductIds 在商品重复时抛出异常', () => {
    expect(() =>
      extractUniqueProductIds([
        { productId: 201, quantity: 2, unitPrice: 10 },
        { productId: 201, quantity: 1, unitPrice: 12 },
      ]),
    ).toThrow(ConflictException);
  });

  it('createPurchaseProductMap 会建立商品映射', () => {
    const productMap = createPurchaseProductMap(products, [201, 202]);

    expect(productMap.get(201)).toEqual(products[0]);
    expect(productMap.get(202)).toEqual(products[1]);
  });

  it('createPurchaseProductMap 在商品缺失时抛出异常', () => {
    expect(() => createPurchaseProductMap(products.slice(0, 1), [201, 202])).toThrow(
      NotFoundException,
    );
  });

  it('preparePurchaseItems 会优先保留快照字段并计算金额', () => {
    const productMap = createPurchaseProductMap(products.slice(0, 1), [201]);

    expect(
      preparePurchaseItems(
        [
          {
            productId: 201,
            productName: '可口可乐 330ml 快照',
            unit: '箱',
            quantity: 6,
            unitPrice: 12,
          },
        ],
        productMap,
      ),
    ).toEqual([
      {
        productId: 201,
        productName: '可口可乐 330ml 快照',
        unit: '箱',
        quantity: 6,
        unitPrice: 12,
        amount: 72,
      },
    ]);
  });

  it('preparePurchaseItems 支持无码商品并要求商品名称', () => {
    expect(
      preparePurchaseItems(
        [
          {
            productName: '  散装辣条  ',
            quantity: 3,
            unitPrice: 12,
          },
        ],
        new Map(),
      ),
    ).toEqual([
      {
        productId: null,
        productName: '散装辣条',
        unit: null,
        quantity: 3,
        unitPrice: 12,
        amount: 36,
      },
    ]);

    expect(() =>
      preparePurchaseItems(
        [
          {
            quantity: 3,
            unitPrice: 12,
          },
        ],
        new Map(),
      ),
    ).toThrow(BadRequestException);
  });

  it('sumPreparedPurchaseAmount 会汇总金额并保留两位小数', () => {
    expect(
      sumPreparedPurchaseAmount([
        {
          productId: 201,
          productName: '可口可乐 330ml',
          unit: '瓶',
          quantity: 3,
          unitPrice: 3.335,
          amount: 10.01,
        },
        {
          productId: null,
          productName: '散装辣条',
          unit: null,
          quantity: 1,
          unitPrice: 2.335,
          amount: 2.34,
        },
      ]),
    ).toBe(12.35);
  });

  it('buildPurchaseCostTitle 和 calculatePurchaseCompareLastMonth 会返回预期结果', () => {
    expect(buildPurchaseCostTitle('可口可乐供应商')).toBe('可口可乐供应商进货成本');
    expect(buildPurchaseCostTitle(null)).toBe('进货成本');
    expect(calculatePurchaseCompareLastMonth(200, 160, true)).toBe(25);
    expect(calculatePurchaseCompareLastMonth(200, 0, true)).toBeNull();
    expect(calculatePurchaseCompareLastMonth(200, 160, false)).toBeNull();
  });
});
