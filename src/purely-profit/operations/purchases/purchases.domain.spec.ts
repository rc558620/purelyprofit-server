import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  assertPurchaseSupplierInput,
  buildPurchaseCostTitle,
  buildPurchaseListWhere,
  calculatePurchaseCompareLastPeriod,
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

  it('buildPurchaseListWhere 在 custom_month 缺 customDate 时抛错', () => {
    expect(() =>
      buildPurchaseListWhere(18, { period: 'custom_month' }),
    ).toThrow(BadRequestException);
  });

  it('buildPurchaseListWhere 在 custom_range 缺区间参数时抛错', () => {
    expect(() =>
      buildPurchaseListWhere(18, {
        period: 'custom_range',
        rangeStartDate: 1715558400000,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      buildPurchaseListWhere(18, {
        period: 'custom_range',
        rangeEndDate: 1715644799999,
      }),
    ).toThrow(BadRequestException);
  });

  it('resolvePurchaseStatsRanges 在 custom_month 缺 customDate 时抛错', () => {
    expect(() =>
      resolvePurchaseStatsRanges(18, { period: 'custom_month' }),
    ).toThrow(BadRequestException);
  });

  it('resolvePurchaseStatsRanges 在 custom_range 缺区间参数时抛错', () => {
    expect(() =>
      resolvePurchaseStatsRanges(18, {
        period: 'custom_range',
        rangeStartDate: 1715558400000,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      resolvePurchaseStatsRanges(18, {
        period: 'custom_range',
        rangeEndDate: 1715644799999,
      }),
    ).toThrow(BadRequestException);
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

  it('assertPurchaseSupplierInput 在 supplierId=0 时不误判为缺失', () => {
    // supplierId=0 虽然不合法（DTO 层 @Min(1) 会拦截），但 domain 层不应误判
    expect(() =>
      assertPurchaseSupplierInput(0 as unknown as undefined, null),
    ).not.toThrow();
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

  it('extractUniqueProductIds 多条无码商品不触发重复检测', () => {
    // 多条无码商品的 productId 都是 undefined，应被过滤掉，不触发重复检测
    expect(
      extractUniqueProductIds([
        { quantity: 1, unitPrice: 8, productName: '散装辣条' },
        { quantity: 2, unitPrice: 10, productName: '散装饼干' },
      ]),
    ).toEqual([]);
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
    expect(() =>
      createPurchaseProductMap(products.slice(0, 1), [201, 202]),
    ).toThrow(NotFoundException);
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
            unitPrice: 12, // 元
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
        unitPrice: 1200, // 分
        amount: 7200, // 分
      },
    ]);
  });

  it('preparePurchaseItems 在 unitPrice 为 0 时拒绝', () => {
    expect(() =>
      preparePurchaseItems(
        [{ quantity: 2, unitPrice: 0, productName: '散装辣条' }],
        new Map(),
      ),
    ).toThrow(BadRequestException);
  });

  it('preparePurchaseItems 在 unitPrice 为负数时拒绝', () => {
    expect(() =>
      preparePurchaseItems(
        [{ quantity: 2, unitPrice: -1, productName: '散装辣条' }],
        new Map(),
      ),
    ).toThrow(BadRequestException);
  });

  it('preparePurchaseItems 支持无码商品并要求商品名称', () => {
    expect(
      preparePurchaseItems(
        [
          {
            productName: '  散装辣条  ',
            quantity: 3,
            unitPrice: 12, // 元
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
        unitPrice: 1200, // 分
        amount: 3600, // 分
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

  it('sumPreparedPurchaseAmount 会汇总分单位金额（整数求和）', () => {
    expect(
      sumPreparedPurchaseAmount([
        {
          productId: 201,
          productName: '可口可乐 330ml',
          unit: '瓶',
          quantity: 3,
          unitPrice: 334, // 分
          amount: 1001, // 分
        },
        {
          productId: null,
          productName: '散装辣条',
          unit: null,
          quantity: 1,
          unitPrice: 234, // 分
          amount: 234, // 分
        },
      ]),
    ).toBe(1235);
  });

  it('buildPurchaseCostTitle 和 calculatePurchaseCompareLastPeriod 会返回预期结果', () => {
    expect(buildPurchaseCostTitle('可口可乐供应商')).toBe(
      '可口可乐供应商进货成本',
    );
    expect(buildPurchaseCostTitle(null)).toBe('进货成本');
    expect(calculatePurchaseCompareLastPeriod(200, 160, true)).toBe(25);
    expect(calculatePurchaseCompareLastPeriod(200, 0, true)).toBeNull();
    expect(calculatePurchaseCompareLastPeriod(200, 160, false)).toBeNull();
  });
});
