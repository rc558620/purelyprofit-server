import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { HandoverPageShiftRecordService } from '../handover/handover-page-shift-record.service';
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
    employee: {
      findUnique: jest.fn(),
    },
    employeeShift: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const handoverPageShiftRecordService = {
    findStartedUnhandedShiftRecord: jest.fn(),
    findCurrentShiftRecord: jest.fn(),
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
  const logger = {
    warn: jest.fn(),
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
    lastActiveAt: null,
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

  const managerUser: AuthenticatedUser = {
    ...user,
    id: 2,
    email: 'manager@example.com',
    name: '店长',
    currentMembership: {
      staffId: 18,
      storeId: 18,
      role: 'STAFF',
      permissions: ['operation-entry:create', 'sales:create'],
      isActive: true,
      subjectType: 'sub_account',
      linkedEmployeeId: 6,
      subAccountId: 9,
      subAccountRole: 'manager',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  const schedulerSystemUser: AuthenticatedUser = {
    ...user,
    id: 0,
    email: 'system@auto-checkout',
    phone: '',
    name: '系统自动结账',
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      null,
    );
    handoverPageShiftRecordService.findCurrentShiftRecord.mockResolvedValue(
      null,
    );
    prismaService.employee.findUnique.mockResolvedValue(null);
    prismaService.employeeShift.findMany.mockResolvedValue([]);
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
          provide: HandoverPageShiftRecordService,
          useValue: handoverPageShiftRecordService,
        },
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
    Object.assign(service as object, { logger });
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
    expect(cacheInvalidatorService.invalidateSalesDerived).toHaveBeenCalledWith(
      18,
    );
  });

  it('create 复用外层事务时不应提前失效缓存', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
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
      service.create(
        user,
        {
          storeId: 18,
          items: [
            {
              productId: '201',
              productName: '前端旧名称',
              categoryName: '前端旧分类',
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
        },
        {
          skipAccessCheck: true,
          transactionClient,
        },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        options: expect.objectContaining({
          skipAccessCheck: true,
          transactionClient,
        }),
      }),
    );
    expect(
      cacheInvalidatorService.invalidateSalesDerived,
    ).not.toHaveBeenCalled();
  });

  it('create 在兼容 additional 入口时应回退到 operation-entry:create 权限', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];
    const response = { id: '12', orderNo: '#20260514-005' };

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue(response);

    await expect(
      service.create(
        user,
        {
          storeId: 18,
          items: [
            {
              productId: '201',
              productName: '前端旧名称',
              categoryName: '前端旧分类',
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
        },
        { skipAccessCheck: true },
      ),
    ).resolves.toEqual(response);

    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      18,
      'operation-entry:create',
      '无权操作该门店销售记录',
    );
  });

  it('create 在系统自动结账入口下应直接使用可信门店并跳过权限用户校验', async () => {
    const preparedItems = [
      {
        productId: null,
        productName: '台位费（固定）',
        categoryName: '场地费',
        salePrice: 666,
        profit: 666,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];
    const response = { id: 'auto-1', orderNo: '#20260607-001' };

    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(null);
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue(response);

    await expect(
      service.create(
        schedulerSystemUser,
        {
          storeId: 18,
          items: [
            {
              productId: 'SYS_TIME_BILLING',
              productName: '台位费（固定）',
              categoryName: '场地费',
              salePrice: 666,
              profit: 666,
              quantity: 1,
            },
          ],
          totalRevenue: 666,
          totalProfit: 666,
          totalQuantity: 1,
          paymentMethod: 'wechat',
          calcMode: 'business',
        },
        { skipAccessCheck: true },
      ),
    ).resolves.toEqual(response);

    expect(commerceAccessService.resolveSingleStoreId).not.toHaveBeenCalled();
    expect(
      commerceAccessService.findOperatorStaffIdForStore,
    ).toHaveBeenCalledWith(schedulerSystemUser, 18);
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        operatorStaffId: null,
      }),
    );
  });

  it('create 在系统自动结账入口下存在当班员工时应归属到待交班班次员工', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 4, 10, 30, 0));
    const preparedItems = [
      {
        productId: null,
        productName: '台位费（固定）',
        categoryName: '场地费',
        salePrice: 100,
        profit: 100,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];
    const response = { id: 'auto-2', orderNo: '#20260607-002' };

    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(null);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      {
        employeeId: 6,
        employeeName: '早班员工',
        shiftType: 'morning',
        date: new Date('2026-06-04T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '18:00',
      },
    );
    prismaService.employee.findUnique.mockResolvedValue({
      linkedStaffId: 42,
    });
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue(response);

    await expect(
      service.create(
        schedulerSystemUser,
        {
          storeId: 18,
          items: [
            {
              productId: 'SYS_TIME_BILLING',
              productName: '台位费（固定）',
              categoryName: '场地费',
              salePrice: 100,
              profit: 100,
              quantity: 1,
            },
          ],
          totalRevenue: 100,
          totalProfit: 100,
          totalQuantity: 1,
          paymentMethod: 'wechat',
          calcMode: 'business',
        },
        { skipAccessCheck: true },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        operatorStaffId: 42,
      }),
    );
    jest.useRealTimers();
  });

  it('create 在 additional 入口下主账号应归属到待交班班次员工', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 4, 10, 30, 0));
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      {
        employeeId: 6,
        employeeName: '早班员工',
        shiftType: 'morning',
        date: new Date('2026-06-04T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '18:00',
      },
    );
    prismaService.employee.findUnique.mockResolvedValue({
      linkedStaffId: 21,
    });
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue({
      id: '13',
      orderNo: '#20260604-001',
    });

    await service.create(
      user,
      {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
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
      },
      {
        skipAccessCheck: true,
        assignToCurrentShiftOperator: true,
      },
    );

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 21,
      }),
    );

    jest.useRealTimers();
  });

  it('create 在 additional 入口下店长子账号也应归属到待交班班次员工', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 4, 10, 30, 0));
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(18);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      {
        employeeId: 6,
        employeeName: '早班员工',
        shiftType: 'morning',
        date: new Date('2026-06-04T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '18:00',
      },
    );
    prismaService.employee.findUnique.mockResolvedValue({
      linkedStaffId: 21,
    });
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue({
      id: '14',
      orderNo: '#20260604-002',
    });

    await service.create(
      managerUser,
      {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
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
      },
      {
        skipAccessCheck: true,
        assignToCurrentShiftOperator: true,
      },
    );

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 21,
      }),
    );

    jest.useRealTimers();
  });

  it('create 在班次归属查询异常时应回退到当前操作人', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];
    const response = { id: '15', orderNo: '#20260604-003' };

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockRejectedValueOnce(
      new Error('shift lookup timeout'),
    );
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue(response);

    await expect(
      service.create(
        user,
        {
          storeId: 18,
          items: [
            {
              productId: '201',
              productName: '前端旧名称',
              categoryName: '前端旧分类',
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
        },
        {
          skipAccessCheck: true,
          assignToCurrentShiftOperator: true,
        },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 8,
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('resolveOperatorStaffId fallback storeId=18'),
    );
  });

  it('create 在逾期未交班且当天无下一班时仍应归属到当前交班班次员工', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 4, 20, 30, 0));
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      {
        employeeId: 6,
        employeeName: '早班员工',
        shiftType: 'morning',
        date: new Date('2026-06-04T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '18:00',
      },
    );
    prismaService.employee.findUnique.mockResolvedValue({
      linkedStaffId: 21,
    });
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue({
      id: '15',
      orderNo: '#20260604-003',
    });

    await service.create(
      user,
      {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
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
      },
      {
        skipAccessCheck: true,
        assignToCurrentShiftOperator: true,
      },
    );

    expect(prismaService.employeeShift.findMany).not.toHaveBeenCalled();
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 21,
      }),
    );

    jest.useRealTimers();
  });

  it('create 在 additional 入口下应按订单时间匹配历史班次员工', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 5, 0, 30, 0));
    const orderDate = new Date(2026, 5, 4, 17, 30, 0);
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: 15.5,
        profit: 4,
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    handoverPageShiftRecordService.findStartedUnhandedShiftRecord.mockResolvedValue(
      null,
    );
    handoverPageShiftRecordService.findCurrentShiftRecord.mockResolvedValue({
      employeeId: 7,
      employeeName: '晚班员工',
      shiftType: 'night',
      date: new Date(2026, 5, 4, 0, 0, 0),
      startTime: '17:00',
      endTime: '23:00',
    });
    prismaService.employee.findUnique.mockResolvedValue({
      linkedStaffId: 26,
    });
    salesRecordItemPreparationService.prepareItems.mockResolvedValue(
      preparedItems,
    );
    salesRecordCreateFlowService.createRecord.mockResolvedValue({
      id: '16',
      orderNo: '#20260604-004',
    });

    await service.create(
      user,
      {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
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
        date: orderDate.getTime(),
      },
      {
        skipAccessCheck: true,
        assignToCurrentShiftOperator: true,
      },
    );

    expect(
      handoverPageShiftRecordService.findStartedUnhandedShiftRecord,
    ).toHaveBeenCalledWith(18, orderDate);
    expect(
      handoverPageShiftRecordService.findCurrentShiftRecord,
    ).toHaveBeenCalledWith(18, null, orderDate);
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 26,
        orderDate,
      }),
    );

    jest.useRealTimers();
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
