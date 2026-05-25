import { Prisma } from '@prisma/client';
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
      price: new Prisma.Decimal('500'),
      profit: new Prisma.Decimal('200'),
      costPrice: new Prisma.Decimal('300'),
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

  it('buildProductResponse 会映射完整商品响应', () => {
    expect(buildProductResponse(createProductRecordFixture())).toEqual({
      id: '11',
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
      createdAt: new Date('2026-05-23T10:00:00.000Z').getTime(),
      updatedAt: new Date('2026-05-23T10:05:00.000Z').getTime(),
    });
  });

  it('buildProductResponse 会省略空成本价、无效图片和空描述', () => {
    expect(
      buildProductResponse(
        createProductRecordFixture({
          costPrice: null,
          image: 'blob:http://localhost/mock-image',
          description: null,
        }),
      ),
    ).toEqual({
      id: '11',
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: 500,
      profit: 200,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      isActive: true,
      createdAt: new Date('2026-05-23T10:00:00.000Z').getTime(),
      updatedAt: new Date('2026-05-23T10:05:00.000Z').getTime(),
    });
  });
});
