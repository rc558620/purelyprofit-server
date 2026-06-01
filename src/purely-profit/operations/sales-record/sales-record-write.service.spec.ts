import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import { SalesRecordItemPreparationService } from './sales-record-item-preparation.service';
import { SalesRecordWriteService } from './sales-record-write.service';

describe('SalesRecordWriteService', () => {
  let service: SalesRecordWriteService;

  const transactionClient = {
    saleOrder: {
      delete: jest.fn(),
    },
    financeCashFlowRecord: {
      deleteMany: jest.fn(),
    },
  };

  const prismaService = {
    saleOrder: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
    findOperatorStaffIdForStore: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const inventoryService = {
    revertSaleDeduction: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateSalesDerived: jest.fn().mockResolvedValue(undefined),
  };

  const salesRecordItemPreparationService = {
    prepareItems: jest.fn(),
  };

  const salesRecordCreateFlowService = {
    createRecord: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
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
        SalesRecordWriteService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: InventoryService, useValue: inventoryService },
        {
          provide: SalesRecordItemPreparationService,
          useValue: salesRecordItemPreparationService,
        },
        {
          provide: SalesRecordCreateFlowService,
          useValue: salesRecordCreateFlowService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordWriteService>(SalesRecordWriteService);
  });

  it('create 会编排门店解析、明细预处理和创建流程', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 2,
        countsTowardTotalQuantity: true,
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
    ];
    const response = { id: '11', orderNo: '#20260514-004' };

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue(response);

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
            salePrice: 15.5,
            profit: 4,
            quantity: 2,
          },
          {
            productId: 'manual_1',
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
        date: new Date('2026-05-14T11:30:00.000Z').getTime(),
      }),
    ).resolves.toEqual(response);

    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      18,
      'sales:create',
      '无权操作该门店销售记录',
    );
    expect(
      commerceAccessService.findOperatorStaffIdForStore,
    ).toHaveBeenCalledWith(user, 18);
    expect(
      salesRecordItemPreparationService.prepareItems,
    ).toHaveBeenCalledTimes(1);
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        operatorStaffId: 8,
        totalRevenue: 49,
        totalProfit: 13,
        totalQuantity: 3,
        note: '补录',
      }),
    );
  });

  it('create 在汇总金额与后端明细不一致时抛出异常并阻止创建流程', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    salesRecordItemPreparationService.prepareItems.mockResolvedValue([
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ]);

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '可口可乐 330ml',
            categoryName: '饮品',
            salePrice: 10,
            profit: 2,
            quantity: 1,
          },
        ],
        totalRevenue: 10,
        totalProfit: 2,
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(salesRecordCreateFlowService.createRecord).not.toHaveBeenCalled();
  });

  it('remove 会回滚库存和财务流水后删除记录', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });

    await service.remove(user, 11);

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'sales:delete',
      '无权删除该销售记录',
    );
    expect(inventoryService.revertSaleDeduction).toHaveBeenCalledWith(
      transactionClient,
      {
        storeId: 18,
        saleOrderId: 11,
      },
    );
    expect(
      transactionClient.financeCashFlowRecord.deleteMany,
    ).toHaveBeenCalledWith({
      where: { storeId: 18, saleOrderId: 11 },
    });
    expect(transactionClient.saleOrder.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
  });

  it('remove 在记录不存在时抛出 NotFoundException', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(commerceAccessService.ensureCanAccessStore).not.toHaveBeenCalled();
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });
});
