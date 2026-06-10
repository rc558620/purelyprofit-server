import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';

describe('SalesRecordCreateFlowService', () => {
  let service: SalesRecordCreateFlowService;

  const transactionClient = {
    $executeRaw: jest.fn(),
    saleOrder: {
      count: jest.fn(),
      create: jest.fn(),
    },
    financeCashFlowRecord: {
      create: jest.fn(),
    },
  };

  const prismaService = {
    $transaction: jest.fn(),
  };

  const inventoryService = {
    recordSaleDeduction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordCreateFlowService,
        { provide: PrismaService, useValue: prismaService },
        { provide: InventoryService, useValue: inventoryService },
      ],
    }).compile();

    service = module.get<SalesRecordCreateFlowService>(
      SalesRecordCreateFlowService,
    );
  });

  it('createRecord 会创建订单、扣减库存并写入财务流水', async () => {
    const orderDate = new Date('2026-05-14T11:30:00.000Z');
    const createdAt = new Date('2026-05-14T11:35:00.000Z');
    transactionClient.saleOrder.count.mockResolvedValue(3);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 11,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-004',
      totalRevenue: new Prisma.Decimal('49'),
      totalProfit: new Prisma.Decimal('13'),
      totalQuantity: 3,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '补录',
      date: orderDate,
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 101,
          orderId: 11,
          storeId: 18,
          productId: 201,
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: new Prisma.Decimal('15.5'),
          profit: new Prisma.Decimal('4'),
          quantity: 2,
          image: 'https://example.com/coke.png',
          createdAt,
        },
        {
          id: 102,
          orderId: 11,
          storeId: 18,
          productId: null,
          productName: '手冲咖啡',
          categoryName: '饮品',
          salePrice: new Prisma.Decimal('18'),
          profit: new Prisma.Decimal('5'),
          quantity: 1,
          image: null,
          createdAt,
        },
      ],
    });

    await expect(
      service.createRecord({
        storeId: 18,
        operatorStaffId: 8,
        dto: {
          items: [],
          totalRevenue: 49,
          totalProfit: 13,
          totalQuantity: 3,
          paymentMethod: 'cash',
          calcMode: 'business',
        } as never,
        preparedItems: [
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
          {
            productId: null,
            productName: '手冲咖啡',
            categoryName: '饮品',
            salePrice: 18,
            profit: 5,
            quantity: 1,
            countsTowardTotalQuantity: true,
          },
        ],
        totalRevenue: 49,
        totalProfit: 13,
        totalQuantity: 3,
        note: '补录',
        orderDate,
      }),
    ).resolves.toEqual({
      id: '11',
      orderNo: '#20260514-004',
      items: [
        {
          productId: '201',
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: 15.5,
          profit: 4,
          quantity: 2,
        },
        {
          productId: 'manual_102',
          productName: '手冲咖啡',
          categoryName: '饮品',
          salePrice: 18,
          profit: 5,
          quantity: 1,
        },
      ],
      totalRevenue: 49,
      totalProfit: 13,
      totalQuantity: 3,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '补录',
      date: orderDate.getTime(),
      createdAt: createdAt.getTime(),
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transactionClient.saleOrder.count).toHaveBeenCalledTimes(1);
    expect(transactionClient.saleOrder.create).toHaveBeenCalledTimes(1);
    expect(inventoryService.recordSaleDeduction).toHaveBeenCalledWith(
      transactionClient,
      {
        storeId: 18,
        saleOrderId: 11,
        operatorStaffId: 8,
        items: [{ productId: 201, quantity: 2 }],
      },
    );
    expect(transactionClient.financeCashFlowRecord.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          storeId: 18,
          saleOrderId: 11,
          direction: 'income',
          category: 'sales',
          amount: new Prisma.Decimal('49'),
          payment: 'cash',
        }),
      },
    );
  });

  it('createRecord 在跳过库存校验时不会触发扣减', async () => {
    const orderDate = new Date('2026-05-14T12:10:00.000Z');
    const createdAt = new Date('2026-05-14T12:12:00.000Z');
    transactionClient.saleOrder.count.mockResolvedValue(4);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 15,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-005',
      totalRevenue: new Prisma.Decimal('20'),
      totalProfit: new Prisma.Decimal('8'),
      totalQuantity: 1,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '空间结账',
      date: orderDate,
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 105,
          orderId: 15,
          storeId: 18,
          productId: 201,
          productName: '面条',
          categoryName: '主食',
          salePrice: new Prisma.Decimal('20'),
          profit: new Prisma.Decimal('8'),
          quantity: 1,
          image: null,
          createdAt,
        },
      ],
    });

    await service.createRecord({
      storeId: 18,
      operatorStaffId: 8,
      dto: {
        items: [],
        totalRevenue: 20,
        totalProfit: 8,
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
      } as never,
      preparedItems: [
        {
          productId: 201,
          productName: '面条',
          categoryName: '主食',
          salePrice: 20,
          profit: 8,
          quantity: 1,
          countsTowardTotalQuantity: true,
        },
      ],
      totalRevenue: 20,
      totalProfit: 8,
      totalQuantity: 1,
      note: '空间结账',
      orderDate,
      options: { skipInventoryValidationAndDeduction: true },
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(inventoryService.recordSaleDeduction).not.toHaveBeenCalled();
    expect(
      transactionClient.financeCashFlowRecord.create,
    ).toHaveBeenCalledTimes(1);
  });
});
