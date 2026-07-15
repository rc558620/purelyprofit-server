import {
  createProductCategory,
  createProductRecord,
  deleteProductRecord,
  findProductById,
  findProductCategoryByName,
  findProductCodeConflict,
  findProductStore,
  queryProductPage,
  resolveProductOrderBy,
  updateProductRecord,
} from './products.query';
import type { ProductRecord } from './products.types';
import { aValidDate } from '../../../spec-matchers';

describe('products.query', () => {
  function createPrismaMock() {
    const productFindMany = jest.fn();
    const productCount = jest.fn();
    const productFindUnique = jest.fn();
    const productFindFirst = jest.fn();
    const productCreate = jest.fn();
    const productUpdate = jest.fn();
    const productDelete = jest.fn();
    const productCategoryFindFirst = jest.fn();
    const productCategoryCreate = jest.fn();

    return {
      prisma: {
        product: {
          findMany: productFindMany,
          count: productCount,
          findUnique: productFindUnique,
          findFirst: productFindFirst,
          create: productCreate,
          update: productUpdate,
          delete: productDelete,
        },
        productCategory: {
          findFirst: productCategoryFindFirst,
          create: productCategoryCreate,
        },
      },
      productFindMany,
      productCount,
      productFindUnique,
      productFindFirst,
      productCreate,
      productUpdate,
      productDelete,
      productCategoryFindFirst,
      productCategoryCreate,
    };
  }

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
      updatedAt: createdAt,
      ...overrides,
    };
  }

  it('resolveProductOrderBy 会返回统一排序配置', () => {
    expect(resolveProductOrderBy('name')).toEqual([
      { name: 'asc' },
      { id: 'desc' },
    ]);
    expect(resolveProductOrderBy()).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('queryProductPage 会按筛选条件和统一 select 查询商品分页', async () => {
    const { prisma, productFindMany, productCount } = createPrismaMock();
    const rows = [createProductRecordFixture()];
    productFindMany.mockResolvedValue(rows);
    productCount.mockResolvedValue(3);

    await expect(
      queryProductPage(prisma as never, {
        storeId: 18,
        query: {
          keyword: '可乐',
          category: '饮品',
          isActive: true,
          sortBy: 'price_desc',
        },
        skip: 2,
        take: 10,
      }),
    ).resolves.toEqual({
      items: rows,
      total: 3,
    });

    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        category: '饮品',
        isActive: true,
        OR: [
          {
            name: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
          {
            code: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: [{ price: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 10,
      select: {
        id: true,
        storeId: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(productCount).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        category: '饮品',
        isActive: true,
        OR: [
          {
            name: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
          {
            code: {
              contains: '可乐',
              mode: 'insensitive',
            },
          },
        ],
      },
    });
  });

  it('findProductById 和 findProductStore 会按统一字段查询', async () => {
    const { prisma, productFindUnique } = createPrismaMock();
    productFindUnique
      .mockResolvedValueOnce(createProductRecordFixture())
      .mockResolvedValueOnce({ id: 11, storeId: 18 });

    await expect(findProductById(prisma as never, 11)).resolves.toEqual(
      createProductRecordFixture(),
    );
    await expect(findProductStore(prisma as never, 11)).resolves.toEqual({
      id: 11,
      storeId: 18,
    });

    expect(productFindUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 11 },
      select: {
        id: true,
        storeId: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(productFindUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 11 },
      select: {
        id: true,
        storeId: true,
      },
    });
  });

  it('分类与编号相关查询会限制在门店维度', async () => {
    const {
      prisma,
      productCategoryFindFirst,
      productCategoryCreate,
      productFindFirst,
    } = createPrismaMock();
    productCategoryFindFirst.mockResolvedValue({ id: 7 });
    productCategoryCreate.mockResolvedValue({ id: 8 });
    productFindFirst.mockResolvedValue({ id: 99 });

    await expect(
      findProductCategoryByName(prisma as never, 18, '饮品'),
    ).resolves.toEqual({ id: 7 });
    await expect(
      createProductCategory(prisma as never, 18, '小食'),
    ).resolves.toEqual({
      id: 8,
    });
    await expect(
      findProductCodeConflict(prisma as never, {
        storeId: 18,
        code: 'SKU-001',
        excludeId: 11,
      }),
    ).resolves.toEqual({ id: 99 });

    expect(productCategoryFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        name: '饮品',
      },
      select: {
        id: true,
      },
    });
    expect(productCategoryCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '小食',
      },
      select: {
        id: true,
      },
    });
    expect(productFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        code: 'SKU-001',
        id: { not: 11 },
      },
      select: {
        id: true,
      },
    });
  });

  it('create/update/delete 会复用统一数据写入结构', async () => {
    const { prisma, productCreate, productUpdate } = createPrismaMock();
    const row = createProductRecordFixture();
    productCreate.mockResolvedValue(row);
    productUpdate.mockResolvedValue({ ...row, name: '雪碧' });

    await expect(
      createProductRecord(prisma as never, {
        storeId: 18,
        categoryId: 7,
        category: '饮品',
        code: 'SKU-001',
        name: '可乐',
        price: 500,
        profit: 200,
        costPrice: 300,
        unit: '瓶',
        stock: 10,
        alertThreshold: 3,
        image: null,
        description: null,
      }),
    ).resolves.toEqual(row);

    await expect(
      updateProductRecord(prisma as never, 11, {
        name: '雪碧',
        image: null,
      }),
    ).resolves.toEqual({ ...row, name: '雪碧' });

    await deleteProductRecord(prisma as never, 11);

    expect(productCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        categoryId: 7,
        category: '饮品',
        code: 'SKU-001',
        name: '可乐',
        price: 500,
        profit: 200,
        costPrice: 300,
        unit: '瓶',
        stock: 10,
        alertThreshold: 3,
        image: null,
        description: null,
      },
      select: {
        id: true,
        storeId: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        name: '雪碧',
        image: null,
      },
      select: {
        id: true,
        storeId: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { deletedAt: aValidDate },
    });
  });
});
