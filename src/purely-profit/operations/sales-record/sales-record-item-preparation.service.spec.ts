import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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
        price: new Prisma.Decimal('15.50'),
        profit: new Prisma.Decimal('4.00'),
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
        totalRevenue: 31,
        totalProfit: 8,
        totalQuantity: 2,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).resolves.toEqual([
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
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
        price: new Prisma.Decimal('20.00'),
        profit: new Prisma.Decimal('8.00'),
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
          totalRevenue: 20,
          totalProfit: 8,
          totalQuantity: 1,
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
        salePrice: 20,
        profit: 8,
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
        totalRevenue: -30,
        totalProfit: -30,
        totalQuantity: 0,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).resolves.toEqual([
      {
        productId: null,
        productName: '续费抵扣',
        categoryName: '场地费',
        salePrice: -30,
        profit: -30,
        quantity: 1,
        countsTowardTotalQuantity: false,
      },
    ]);
  });

  it('prepareItems 在抵扣项销售额和利润异号时抛出 BadRequestException', async () => {
    prismaService.product.findMany.mockResolvedValue([]);

    await expect(
      service.prepareItems(18, {
        items: [
          {
            productId: 'SYS_RENEW_DEDUCTION',
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: -20,
            profit: 20,
            quantity: 1,
          },
        ],
        totalRevenue: -20,
        totalProfit: 20,
        totalQuantity: 0,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prepareItems 在商品不存在时抛出 NotFoundException', async () => {
    prismaService.product.findMany.mockResolvedValue([]);

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
        totalRevenue: 15.5,
        totalProfit: 4,
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prepareItems 在商品下架或库存不足时抛出 BadRequestException', async () => {
    prismaService.product.findMany
      .mockResolvedValueOnce([
        {
          id: 201,
          name: '可口可乐 330ml',
          category: '饮品',
          code: 'COLA001',
          price: new Prisma.Decimal('15.50'),
          profit: new Prisma.Decimal('4.00'),
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
          price: new Prisma.Decimal('12.00'),
          profit: new Prisma.Decimal('3.00'),
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
        totalRevenue: 15.5,
        totalProfit: 4,
        totalQuantity: 1,
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
        totalRevenue: 24,
        totalProfit: 6,
        totalQuantity: 2,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
