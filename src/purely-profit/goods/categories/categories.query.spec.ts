import {
  CATEGORY_ID_SELECT,
  CATEGORY_SELECT,
  clearCategoryProducts,
  createCategoryRecord,
  deleteCategoryRecord,
  findCategoryById,
  findCategoryDuplicateByName,
  listCategoryRecords,
  renameCategoryProducts,
  updateCategoryRecord,
} from './categories.query';
import type { CategoryRecord } from './categories.types';
import { aValidDate } from '../../../spec-matchers';

describe('categories.query', () => {
  function createPrismaMock() {
    const productCategoryFindMany = jest.fn();
    const productCategoryFindUnique = jest.fn();
    const productCategoryFindFirst = jest.fn();
    const productCategoryCreate = jest.fn();
    const productCategoryUpdate = jest.fn();
    const productCategoryDelete = jest.fn();
    const productUpdateMany = jest.fn();

    return {
      prisma: {
        productCategory: {
          findMany: productCategoryFindMany,
          findUnique: productCategoryFindUnique,
          findFirst: productCategoryFindFirst,
          create: productCategoryCreate,
          update: productCategoryUpdate,
          delete: productCategoryDelete,
        },
        product: {
          updateMany: productUpdateMany,
        },
      },
      productCategoryFindMany,
      productCategoryFindUnique,
      productCategoryFindFirst,
      productCategoryCreate,
      productCategoryUpdate,
      productCategoryDelete,
      productUpdateMany,
    };
  }

  function createCategoryRecordFixture(
    overrides?: Partial<CategoryRecord>,
  ): CategoryRecord {
    return {
      id: 11,
      storeId: 18,
      name: '饮品',
      icon: '🥤',
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
      ...overrides,
    };
  }

  it('listCategoryRecords 会按门店、关键词和统一 select 查询分类列表', async () => {
    const { prisma, productCategoryFindMany } = createPrismaMock();
    const rows = [createCategoryRecordFixture()];
    productCategoryFindMany.mockResolvedValue(rows);

    await expect(
      listCategoryRecords(prisma as never, {
        storeId: 18,
        keyword: '饮',
      }),
    ).resolves.toEqual(rows);

    expect(productCategoryFindMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        name: {
          contains: '饮',
          mode: 'insensitive',
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: CATEGORY_SELECT,
    });
  });

  it('findCategoryById 会按统一字段查询分类详情', async () => {
    const { prisma, productCategoryFindUnique } = createPrismaMock();
    const row = createCategoryRecordFixture();
    productCategoryFindUnique.mockResolvedValue(row);

    await expect(findCategoryById(prisma as never, 11)).resolves.toEqual(row);

    expect(productCategoryFindUnique).toHaveBeenCalledWith({
      where: { id: 11 },
      select: CATEGORY_SELECT,
    });
  });

  it('findCategoryDuplicateByName 会使用 insensitive 匹配并支持排除自身', async () => {
    const { prisma, productCategoryFindFirst } = createPrismaMock();
    productCategoryFindFirst.mockResolvedValue({ id: 99 });

    await expect(
      findCategoryDuplicateByName(prisma as never, {
        storeId: 18,
        name: '饮品',
        excludeId: 11,
      }),
    ).resolves.toEqual({ id: 99 });

    expect(productCategoryFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        deletedAt: null,
        name: {
          equals: '饮品',
          mode: 'insensitive',
        },
        id: {
          not: 11,
        },
      },
      select: CATEGORY_ID_SELECT,
    });
  });

  it('createCategoryRecord 和 updateCategoryRecord 会复用统一 select', async () => {
    const { prisma, productCategoryCreate, productCategoryUpdate } =
      createPrismaMock();
    const created = createCategoryRecordFixture();
    const updated = createCategoryRecordFixture({
      name: '酒水',
      icon: null,
      updatedAt: new Date('2026-05-23T11:00:00.000Z'),
    });
    productCategoryCreate.mockResolvedValue(created);
    productCategoryUpdate.mockResolvedValue(updated);

    await expect(
      createCategoryRecord(prisma as never, {
        storeId: 18,
        name: '饮品',
        icon: '🥤',
      }),
    ).resolves.toEqual(created);
    await expect(
      updateCategoryRecord(prisma as never, 11, {
        name: '酒水',
        icon: null,
      }),
    ).resolves.toEqual(updated);

    expect(productCategoryCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '饮品',
        icon: '🥤',
      },
      select: CATEGORY_SELECT,
    });
    expect(productCategoryUpdate).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        name: '酒水',
        icon: null,
      },
      select: CATEGORY_SELECT,
    });
  });

  it('renameCategoryProducts 会同步商品分类名称', async () => {
    const { prisma, productUpdateMany } = createPrismaMock();
    productUpdateMany.mockResolvedValue({ count: 3 });

    await expect(
      renameCategoryProducts(prisma as never, {
        storeId: 18,
        categoryId: 11,
        name: '酒水',
      }),
    ).resolves.toBeUndefined();

    expect(productUpdateMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        categoryId: 11,
      },
      data: {
        category: '酒水',
      },
    });
  });

  it('clearCategoryProducts 会清空商品的 category 和 categoryId', async () => {
    const { prisma, productUpdateMany } = createPrismaMock();
    productUpdateMany.mockResolvedValue({ count: 5 });

    await expect(
      clearCategoryProducts(prisma as never, {
        storeId: 18,
        categoryId: 11,
      }),
    ).resolves.toBeUndefined();

    expect(productUpdateMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        categoryId: 11,
      },
      data: {
        category: '',
        categoryId: null,
      },
    });
  });

  it('deleteCategoryRecord 会软删除分类记录', async () => {
    const { prisma, productCategoryUpdate } = createPrismaMock();
    productCategoryUpdate.mockResolvedValue({ id: 11 });

    await expect(
      deleteCategoryRecord(prisma as never, 11),
    ).resolves.toBeUndefined();

    expect(productCategoryUpdate).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { deletedAt: aValidDate },
    });
  });
});
