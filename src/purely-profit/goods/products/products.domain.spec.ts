import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import {
  createCategoryRecord,
  findCategoryDuplicateByName,
} from '../categories/categories.query';
import {
  deriveProductProfit,
  deriveProductProfitRate,
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
  validateDerivedProfit,
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
        deletedAt: null,
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

  describe('deriveProductProfit', () => {
    it('无成本价时利润等于售价', () => {
      const price = Money.fromInputYuan(10);
      expect(deriveProductProfit(price, null).toOutputYuan()).toBe(10);
      expect(deriveProductProfit(price, undefined).toOutputYuan()).toBe(10);
    });

    it('有成本价时利润 = 售价 − 成本价', () => {
      const price = Money.fromInputYuan(10);
      const costPrice = Money.fromInputYuan(6);
      expect(deriveProductProfit(price, costPrice).toOutputYuan()).toBe(4);
    });

    it('成本价等于售价时利润为 0', () => {
      const price = Money.fromInputYuan(8);
      const costPrice = Money.fromInputYuan(8);
      expect(deriveProductProfit(price, costPrice).toOutputYuan()).toBe(0);
    });

    it('成本价大于售价时利润为负数', () => {
      const price = Money.fromInputYuan(5);
      const costPrice = Money.fromInputYuan(10);
      const profit = deriveProductProfit(price, costPrice);
      expect(profit.toOutputYuan()).toBe(-5);
      expect(profit.isNegative()).toBe(true);
    });

    it('小数精度场景下利润推导正确', () => {
      const price = Money.fromInputYuan(9.99);
      const costPrice = Money.fromInputYuan(3.5);
      expect(deriveProductProfit(price, costPrice).toOutputYuan()).toBe(6.49);
    });
  });

  describe('validateDerivedProfit', () => {
    it('利润为正时不抛错', () => {
      const profit = Money.fromInputYuan(2.5);
      expect(() => validateDerivedProfit(profit)).not.toThrow();
    });

    it('利润为零时抛错', () => {
      const profit = Money.zero();
      expect(() => validateDerivedProfit(profit)).toThrow(
        new BadRequestException('每单利润必须大于 0（成本价不能大于等于售价）'),
      );
    });

    it('利润为负时抛错', () => {
      const profit = Money.fromInputYuan(5).subtract(Money.fromInputYuan(10));
      expect(() => validateDerivedProfit(profit)).toThrow(
        new BadRequestException('每单利润必须大于 0（成本价不能大于等于售价）'),
      );
    });
  });

  describe('deriveProductProfitRate', () => {
    it('正常计算利润率', () => {
      // profit=200分, price=500分 → 200/500*100 = 40.0%
      const price = Money.fromDbCents(500);
      const profit = Money.fromDbCents(200);
      expect(deriveProductProfitRate(price, profit)).toBe(40.0);
    });

    it('利润率保留一位小数', () => {
      // profit=300分, price=800分 → 300/800*100 = 37.5%
      const price = Money.fromDbCents(800);
      const profit = Money.fromDbCents(300);
      expect(deriveProductProfitRate(price, profit)).toBe(37.5);
    });

    it('无成本价时利润率 = 100%', () => {
      // costPrice=null → profit=price → profitRate = 100%
      const price = Money.fromInputYuan(10);
      const profit = deriveProductProfit(price, null);
      expect(deriveProductProfitRate(price, profit)).toBe(100.0);
    });

    it('售价 ≤ 0 时返回 0', () => {
      const price = Money.zero();
      const profit = Money.fromDbCents(100);
      expect(deriveProductProfitRate(price, profit)).toBe(0);
    });

    it('利润为 0 时利润率为 0%', () => {
      const price = Money.fromInputYuan(10);
      const profit = Money.zero();
      expect(deriveProductProfitRate(price, profit)).toBe(0);
    });
  });
});
