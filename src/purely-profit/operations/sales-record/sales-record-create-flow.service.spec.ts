import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import { Money } from '../../../shared/money.utils';

describe('SalesRecordCreateFlowService', () => {
  let service: SalesRecordCreateFlowService;

  const transactionClient = {
    $executeRaw: jest.fn(),
    saleOrder: {
      count: jest.fn(),
      findMany: jest.fn(),
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
    transactionClient.saleOrder.findMany.mockResolvedValue([
      { orderNo: '#20260514-003' },
    ]);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 11,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-004',
      totalRevenue: new Prisma.Decimal('4900'),
      totalProfit: new Prisma.Decimal('1300'),
      totalQuantity: 3,
      paymentMethod: 'cash',
      paymentLabel: '现金',
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
          salePrice: new Prisma.Decimal('1550'),
          profit: new Prisma.Decimal('400'),
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
          salePrice: new Prisma.Decimal('1800'),
          profit: new Prisma.Decimal('500'),
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
            salePrice: Money.fromDbCents(1550),
            profit: Money.fromDbCents(400),
            quantity: 2,
            countsTowardTotalQuantity: true,
            image: 'https://example.com/coke.png',
          },
          {
            productId: null,
            productName: '手冲咖啡',
            categoryName: '饮品',
            salePrice: Money.fromDbCents(1800),
            profit: Money.fromDbCents(500),
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
          subtotal: 31,
        },
        {
          productId: 'manual_102',
          productName: '手冲咖啡',
          categoryName: '饮品',
          salePrice: 18,
          profit: 5,
          quantity: 1,
          subtotal: 18,
        },
      ],
      totalRevenue: 49,
      totalProfit: 13,
      totalQuantity: 3,
      paymentMethod: 'cash',
      paymentLabel: '现金',
      calcMode: 'business',
      note: '补录',
      date: orderDate.getTime(),
      createdAt: createdAt.getTime(),
      refundedAt: null,
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transactionClient.saleOrder.findMany).toHaveBeenCalledTimes(1);
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
          amount: 4900,
          payment: 'cash',
        }),
      },
    );
  });

  it('createRecord 复用外层事务时不应再次开启事务', async () => {
    const orderDate = new Date('2026-05-14T12:10:00.000Z');
    const createdAt = new Date('2026-05-14T12:12:00.000Z');
    transactionClient.saleOrder.findMany.mockResolvedValue([
      { orderNo: '#20260514-004' },
    ]);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 15,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-005',
      totalRevenue: new Prisma.Decimal('2000'),
      totalProfit: new Prisma.Decimal('800'),
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
          salePrice: new Prisma.Decimal('2000'),
          profit: new Prisma.Decimal('800'),
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
          salePrice: Money.fromDbCents(2000),
          profit: Money.fromDbCents(800),
          quantity: 1,
          countsTowardTotalQuantity: true,
        },
      ],
      totalRevenue: 20,
      totalProfit: 8,
      totalQuantity: 1,
      note: '空间结账',
      orderDate,
      options: {
        skipInventoryValidationAndDeduction: true,
        transactionClient: transactionClient as never,
      },
    });

    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(inventoryService.recordSaleDeduction).not.toHaveBeenCalled();
    expect(
      transactionClient.financeCashFlowRecord.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('createRecord 在跳过库存校验时不会触发扣减', async () => {
    const orderDate = new Date('2026-05-14T12:10:00.000Z');
    const createdAt = new Date('2026-05-14T12:12:00.000Z');
    transactionClient.saleOrder.findMany.mockResolvedValue([
      { orderNo: '#20260514-004' },
    ]);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 15,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-005',
      totalRevenue: new Prisma.Decimal('2000'),
      totalProfit: new Prisma.Decimal('800'),
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
          salePrice: new Prisma.Decimal('2000'),
          profit: new Prisma.Decimal('800'),
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
          salePrice: Money.fromDbCents(2000),
          profit: Money.fromDbCents(800),
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

  it('订单号按当日最大序号递增，删除中间单据后不会复用已占用序号', async () => {
    const orderDate = new Date('2026-05-14T13:00:00.000Z');
    const createdAt = new Date('2026-05-14T13:02:00.000Z');
    // 模拟 #002 已被删除：现存单据只有 2 条，但最大序号仍是 003
    transactionClient.saleOrder.findMany.mockResolvedValue([
      { orderNo: '#20260514-001' },
      { orderNo: '#20260514-003' },
    ]);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 16,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-004',
      totalRevenue: new Prisma.Decimal('2000'),
      totalProfit: new Prisma.Decimal('800'),
      totalQuantity: 1,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: null,
      date: orderDate,
      createdAt,
      items: [],
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
      preparedItems: [],
      totalRevenue: 20,
      totalProfit: 8,
      totalQuantity: 1,
      note: null,
      orderDate,
      options: { skipInventoryValidationAndDeduction: true },
    });

    expect(transactionClient.saleOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderNo: '#20260514-004' }),
      }),
    );
  });
});
