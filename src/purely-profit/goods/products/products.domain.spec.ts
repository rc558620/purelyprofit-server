import { ConflictException } from '@nestjs/common';
import {
  createCategoryRecord,
  findCategoryDuplicateByName,
} from '../categories/categories.query';
import {
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
} from './products.domain';

jest.mock('../categories/categories.query', () => ({
  createCategoryRecord: jest.fn(),
  findCategoryDuplicateByName: jest.fn(),
}));

describe('products.domain', () => {
  function createPrismaMock() {
    const productFindFirst = jest.fn();

    return {
      prisma: {
        product: {
          findFirst: productFindFirst,
        },
      },
      productFindFirst,
    };
  }

  it('ensureProductCategory 会复用已有分类并忽略空白分类名', async () => {
    const { prisma } = createPrismaMock();
    const mockedFindCategoryDuplicateByName = jest.mocked(
      findCategoryDuplicateByName,
    );
    mockedFindCategoryDuplicateByName.mockResolvedValue({ id: 7 });

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

    expect(mockedFindCategoryDuplicateByName).toHaveBeenCalledWith(prisma, {
      storeId: 18,
      name: '饮品',
    });
  });

  it('ensureProductCategory 会在分类不存在时通过 categories query 创建分类', async () => {
    const { prisma } = createPrismaMock();
    const mockedFindCategoryDuplicateByName = jest.mocked(
      findCategoryDuplicateByName,
    );
    const mockedCreateCategoryRecord = jest.mocked(createCategoryRecord);
    mockedFindCategoryDuplicateByName.mockResolvedValue(null);
    mockedCreateCategoryRecord.mockResolvedValue({
      id: 8,
      storeId: 18,
      name: '小食',
      icon: null,
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:00:00.000Z'),
    });

    await expect(
      ensureProductCategory(prisma as never, {
        storeId: 18,
        categoryName: '小食',
      }),
    ).resolves.toEqual({ id: 8 });

    expect(mockedCreateCategoryRecord).toHaveBeenCalledWith(prisma, {
      storeId: 18,
      name: '小食',
      icon: null,
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
