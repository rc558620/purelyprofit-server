import { ConflictException } from '@nestjs/common';
import {
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
} from './products.domain';

describe('products.domain', () => {
  function createPrismaMock() {
    const productCategoryFindFirst = jest.fn();
    const productCategoryCreate = jest.fn();
    const productFindFirst = jest.fn();

    return {
      prisma: {
        productCategory: {
          findFirst: productCategoryFindFirst,
          create: productCategoryCreate,
        },
        product: {
          findFirst: productFindFirst,
        },
      },
      productCategoryFindFirst,
      productCategoryCreate,
      productFindFirst,
    };
  }

  it('ensureProductCategory 会复用已有分类并忽略空白分类名', async () => {
    const { prisma, productCategoryFindFirst } = createPrismaMock();
    productCategoryFindFirst.mockResolvedValue({ id: 7 });

    await expect(
      ensureProductCategory(prisma as never, {
        storeId: 18,
        categoryName: ' 饮品 ',
      }),
    ).resolves.toEqual({ id: 7 });
    await expect(
      ensureProductCategory(prisma as never, {
        storeId: 18,
        categoryName: '   ',
      }),
    ).resolves.toBeNull();

    expect(productCategoryFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        name: '饮品',
      },
      select: {
        id: true,
      },
    });
  });

  it('ensureProductCategory 会在分类不存在时创建分类', async () => {
    const { prisma, productCategoryFindFirst, productCategoryCreate } =
      createPrismaMock();
    productCategoryFindFirst.mockResolvedValue(null);
    productCategoryCreate.mockResolvedValue({ id: 8 });

    await expect(
      ensureProductCategory(prisma as never, {
        storeId: 18,
        categoryName: '小食',
      }),
    ).resolves.toEqual({ id: 8 });

    expect(productCategoryCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '小食',
      },
      select: {
        id: true,
      },
    });
  });

  it('ensureUniqueProductCode 会在编号冲突时抛错', async () => {
    const { prisma, productFindFirst } = createPrismaMock();
    productFindFirst.mockResolvedValue({ id: 99 });

    await expect(
      ensureUniqueProductCode(prisma as never, {
        storeId: 18,
        code: 'SKU-001',
        excludeId: 11,
      }),
    ).rejects.toThrow(new ConflictException('商品编号已存在'));

    expect(productFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        code: 'SKU-001',
        id: { not: 11 },
      },
      select: {
        id: true,
      },
    });
  });

  it('resolveProductCode 会优先复用传入编号并在缺省时生成可用编号', async () => {
    const { prisma, productFindFirst } = createPrismaMock();
    productFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);

    await expect(
      resolveProductCode(prisma as never, {
        storeId: 18,
        code: ' SKU-001 ',
      }),
    ).resolves.toBe('SKU-001');

    await expect(
      resolveProductCode(prisma as never, {
        storeId: 18,
        generateCode: jest
          .fn()
          .mockReturnValueOnce('PRD-1')
          .mockReturnValueOnce('PRD-2'),
      }),
    ).resolves.toBe('PRD-2');
  });

  it('resolveProductCode 会在连续生成冲突后抛错', async () => {
    const { prisma, productFindFirst } = createPrismaMock();
    productFindFirst.mockResolvedValue({ id: 1 });

    await expect(
      resolveProductCode(prisma as never, {
        storeId: 18,
        generateCode: jest.fn().mockReturnValue('PRD-1'),
      }),
    ).rejects.toThrow(new ConflictException('商品编号生成失败，请重试'));
  });
});
