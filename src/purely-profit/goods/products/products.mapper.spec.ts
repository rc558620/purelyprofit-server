import { buildProductResponse } from './products.mapper';
import type { ProductRecord } from './products.types';

describe('products.mapper', () => {
  function createProductRecordFixture(
    overrides?: Partial<ProductRecord>,
  ): ProductRecord {
    const createdAt = new Date('2026-05-23T10:00:00.000Z');

    return {
      id: 11,
      storeId: 18,
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: 500,
      profit: 200,
      costPrice: 300,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      image: 'https://example.com/coke.png',
      description: '冰镇口感更佳',
      isActive: true,
      createdAt,
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
      ...overrides,
    };
  }

  it('buildProductResponse 会映射完整商品响应，含 profitRate', () => {
    // price=500分(5元), profit=200分(2元) → profitRate = 200/500*100 = 40.0%
    expect(buildProductResponse(createProductRecordFixture())).toEqual({
      id: '11',
      storeId: 18,
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: 5,
      profit: 2,
      profitRate: 40.0,
      costPrice: 3,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      image: 'https://example.com/coke.png',
      description: '冰镇口感更佳',
      isActive: true,
      createdAt: new Date('2026-05-23T10:00:00.000Z').getTime(),
      updatedAt: new Date('2026-05-23T10:05:00.000Z').getTime(),
    });
  });

  it('buildProductResponse 会省略空成本价、无效图片和空描述', () => {
    // costPrice=null → profit 应等于 price（500分=5元） → profitRate=100%
    expect(
      buildProductResponse(
        createProductRecordFixture({
          costPrice: null,
          profit: 500, // 无成本价时利润=售价
          image: 'blob:http://localhost/mock-image',
          description: null,
        }),
      ),
    ).toEqual({
      id: '11',
      storeId: 18,
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: 5,
      profit: 5,
      profitRate: 100.0,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      isActive: true,
      createdAt: new Date('2026-05-23T10:00:00.000Z').getTime(),
      updatedAt: new Date('2026-05-23T10:05:00.000Z').getTime(),
    });
  });

  it('profitRate 保留一位小数', () => {
    // price=800分(8元), profit=300分(3元) → 300/800*100 = 37.5%
    expect(
      buildProductResponse(
        createProductRecordFixture({ price: 800, profit: 300, costPrice: 500 }),
      ).profitRate,
    ).toBe(37.5);
  });
});
