import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import { SalesRecordItemPreparationService } from './sales-record-item-preparation.service';

describe('SalesRecordItemPreparationService', () => {
  let service: SalesRecordItemPreparationService;

  const prismaService = {
    product: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordItemPreparationService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<SalesRecordItemPreparationService>(
      SalesRecordItemPreparationService,
    );
  });

  it('prepareItems 会优先采用商品主数据并保留图片信息', async () => {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: 1550, // 15.50 元 = 1550 分
        profit: 400, // 4.00 元 = 400 分
        stock: 20,
        isActive: true,
        image: 'https://example.com/coke.png',
      },
    ]);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
            salePrice: 10,
            profit: 2,
            quantity: 2,
          },
        ],
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromDbCents(1550),
        profit: Money.fromDbCents(400),
        quantity: 2,
        countsTowardTotalQuantity: true,
        image: 'https://example.com/coke.png',
      },
    ]);
  });

  it('prepareItems 支持跳过库存校验与扣减选项', async () => {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '面条',
        category: '主食',
        code: 'NOODLE001',
        price: 2000, // 20.00 元 = 2000 分
        profit: 800, // 8.00 元 = 800 分
        stock: 0,
        isActive: true,
        image: null,
      },
    ]);

    await expect(
      service.prepareItems(
        18,
        {
          items: [
            {
              productId: '201',
              productName: '面条',
              categoryName: '主食',
              salePrice: 20,
              profit: 8,
              quantity: 1,
            },
          ],
          paymentMethod: 'cash',
          calcMode: 'business',
        },
        { skipInventoryValidationAndDeduction: true },
      ),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '面条',
        categoryName: '主食',
        salePrice: Money.fromDbCents(2000),
        profit: Money.fromDbCents(800),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ]);
  });

  it('prepareItems 支持负数抵扣项且不计入总销售件数', async () => {
    prismaService.product.findMany.mockResolvedValue([]);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: 'SYS_RENEW_DEDUCTION',
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: -30,
            profit: -30,
            quantity: 1,
          },
        ],
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).resolves.toEqual([
      {
        productId: null,
        productName: '续费抵扣',
        categoryName: '场地费',
        salePrice: Money.fromInputYuan(-30),
        profit: Money.fromInputYuan(-30),
        quantity: 1,
        countsTowardTotalQuantity: false,
        systemProductId: 'SYS_RENEW_DEDUCTION',
      },
    ]);
  });

  it('prepareItems 抵扣项利润由后端从售价推导（忽略前端传入值）', async () => {
    prismaService.product.findMany.mockResolvedValue([]);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: 'SYS_RENEW_DEDUCTION',
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: -30,
            profit: 999, // 前端传入任意值，后端都会忽略
            quantity: 1,
          },
        ],
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).resolves.toEqual([
      {
        productId: null,
        productName: '续费抵扣',
        categoryName: '场地费',
        salePrice: Money.fromInputYuan(-30),
        profit: Money.fromInputYuan(-30), // 后端从售价推导
        quantity: 1,
        countsTowardTotalQuantity: false,
        systemProductId: 'SYS_RENEW_DEDUCTION',
      },
    ]);
  });

  it('prepareItems 在商品不存在时回退为手动项而非阻断', async () => {
    prismaService.product.findMany.mockResolvedValue([]);

    const result = await service.prepareItems(18, {
      items: [
        {
          productId: '201',
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: 15.5,
          profit: 4,
          quantity: 1,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'business',
    });

    expect(result).toEqual([
      {
        productId: null,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(15.5),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ]);
  });

  it('prepareItems 在商品下架或库存不足时抛出 BadRequestException', async () => {
    prismaService.product.findMany
      .mockResolvedValueOnce([
        {
          id: 201,
          name: '可口可乐 330ml',
          category: '饮品',
          code: 'COLA001',
          price: 1550, // 15.50 元 = 1550 分
          profit: 400, // 4.00 元 = 400 分
          stock: 20,
          isActive: false,
          image: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 202,
          name: '雪碧',
          category: '饮品',
          code: 'SPRITE001',
          price: 1200, // 12.00 元 = 1200 分
          profit: 300, // 3.00 元 = 300 分
          stock: 1,
          isActive: true,
          image: null,
        },
      ]);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: '201',
            productName: '可口可乐 330ml',
            categoryName: '饮品',
            salePrice: 15.5,
            profit: 4,
            quantity: 1,
          },
        ],
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: '202',
            productName: '雪碧',
            categoryName: '饮品',
            salePrice: 12,
            profit: 3,
            quantity: 2,
          },
        ],
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prepareItems 在 preserveCallerPrices 时保留调用方传入的价格而非商品目录价格', async () => {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: 1550, // 15.50 元 = 1550 分
        profit: 400, // 4.00 元 = 400 分
        stock: 20,
        isActive: true,
        image: null,
      },
    ]);

    await expect(
      service.prepareItems(
        18,
        {
          items: [
            {
              productId: '201',
              productName: '可口可乐 330ml',
              categoryName: '饮品',
              salePrice: 10,
              profit: 2,
              quantity: 2,
            },
          ],
          paymentMethod: 'cash',
          calcMode: 'business',
        },
        { preserveCallerPrices: true },
      ),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(10),
        profit: Money.fromInputYuan(2),
        quantity: 2,
        countsTowardTotalQuantity: true,
      },
    ]);
  });

  it('prepareItems 在 preserveCallerSalePrices 时保留成交价，但利润按成本价推导（前端利润不可信）', async () => {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: 1550, // 15.50 元 = 1550 分
        profit: 400, // 4.00 元 = 400 分
        costPrice: 600, // 6.00 元 = 600 分
        stock: 20,
        isActive: true,
        image: null,
      },
    ]);

    await expect(
      service.prepareItems(
        18,
        {
          items: [
            {
              productId: '201',
              productName: '可口可乐 330ml',
              categoryName: '饮品',
              salePrice: 10, // 扫码成交价（服务端权威）
              profit: 999, // 前端利润不可信，必须被忽略
              quantity: 1,
            },
          ],
          paymentMethod: 'wechat',
          calcMode: 'business',
        },
        { preserveCallerSalePrices: true },
      ),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(10),
        profit: Money.fromInputYuan(4), // 10 元 − 6 元成本 = 4 元
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ]);
  });

  it('prepareItems 在 preserveCallerSalePrices 且无成本价时，利润按售价推导', async () => {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '手冲咖啡',
        category: '饮品',
        code: 'COFFEE001',
        price: 1800,
        profit: 500,
        costPrice: null,
        stock: 20,
        isActive: true,
        image: null,
      },
    ]);

    await expect(
      service.prepareItems(
        18,
        {
          items: [
            {
              productId: '201',
              productName: '手冲咖啡',
              categoryName: '饮品',
              salePrice: 18,
              profit: 999, // 前端利润不可信
              quantity: 1,
            },
          ],
          paymentMethod: 'wechat',
          calcMode: 'business',
        },
        { preserveCallerSalePrices: true },
      ),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '手冲咖啡',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(18),
        profit: Money.fromInputYuan(18), // 无成本价时利润 = 售价
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ]);
  });
});
