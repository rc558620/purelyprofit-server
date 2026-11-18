import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { Money } from '../../../shared/money.utils';
import { HandoverPageShiftRecordService } from '../handover/handover-page-shift-record.service';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import { SalesRecordItemPreparationService } from './sales-record-item-preparation.service';
import { SalesRecordIdempotencyService } from './sales-record-idempotency.service';
import { SalesRecordWriteService } from './sales-record-write.service';
import { MembershipDowngradeService } from '../../member/platform-membership/membership-downgrade.service';

describe('SalesRecordWriteService', () => {
  let service: SalesRecordWriteService;
  let idempotencyService: SalesRecordIdempotencyService;

  const transactionClient = {
    saleOrder: {
      delete: jest.fn(),
    },
    saleOrderRefund: {
      findUnique: jest.fn(),
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
    staff: {
      findUnique: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    employeeShift: {
      findMany: jest.fn(),
    },
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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

  // 默认「未过期」，不施加任何降级限制；需要验证拦截的用例自行覆盖
  const downgradeService = {
    assertAdditionalEnabled: jest.fn().mockResolvedValue(undefined),
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
      role: 'owner',
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
      role: 'staff',
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
    prismaService.staff.findUnique.mockResolvedValue({ name: 'mock-operator' });
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
        { provide: MembershipDowngradeService, useValue: downgradeService },
        // 幂等服务用真实实现：它的分支（回放/占位/撞键/清理）就是被测逻辑
        SalesRecordIdempotencyService,
      ],
    }).compile();

    service = module.get<SalesRecordWriteService>(SalesRecordWriteService);
    idempotencyService = module.get<SalesRecordIdempotencyService>(
      SalesRecordIdempotencyService,
    );
    Object.assign(service as object, { logger });
  });

  it('create 会编排门店解析、明细预处理和创建流程', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 2,
        countsTowardTotalQuantity: true,
      },
      {
        productId: null,
        productName: '手冲咖啡',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(18),
        profit: Money.fromInputYuan(5),
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
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
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
          paymentMethod: 'cash',
          calcMode: 'business',
        },
        {
          skipAccessCheck: true,
          transactionClient: transactionClient as never,
        },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        options: expect.objectContaining({
          skipAccessCheck: true,
          transactionClient: transactionClient as never,
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
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
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
        salePrice: Money.fromInputYuan(666),
        profit: Money.fromInputYuan(666),
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

  it('create 在系统自动结账入口下即使存在当班员工也不归属到个人', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 4, 10, 30, 0));
    const preparedItems = [
      {
        productId: null,
        productName: '台位费（固定）',
        categoryName: '场地费',
        salePrice: Money.fromInputYuan(100),
        profit: Money.fromInputYuan(100),
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
          paymentMethod: 'wechat',
          calcMode: 'business',
        },
        { skipAccessCheck: true },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 18,
        operatorStaffId: null,
      }),
    );
    jest.useRealTimers();
  });

  it('create 主账号操作时应使用自身 staffId 作为操作员', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
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
        paymentMethod: 'cash',
        calcMode: 'business',
      },
      {
        skipAccessCheck: true,
      },
    );

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 8,
      }),
    );
  });

  it('create 店长子账号操作时应使用自身 staffId 作为操作员', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(18);
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
        paymentMethod: 'cash',
        calcMode: 'business',
      },
      {
        skipAccessCheck: true,
      },
    );

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 18,
      }),
    );
  });

  it('create 主账号操作时不应受班次归属异常影响', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];
    const response = { id: '15', orderNo: '#20260604-003' };

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
          paymentMethod: 'cash',
          calcMode: 'business',
        },
        {
          skipAccessCheck: true,
        },
      ),
    ).resolves.toEqual(response);

    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 8,
      }),
    );
  });

  it('create 主账号操作时应始终使用自身 staffId 不受班次状态影响', async () => {
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
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
        paymentMethod: 'cash',
        calcMode: 'business',
      },
      {
        skipAccessCheck: true,
      },
    );

    expect(prismaService.employeeShift.findMany).not.toHaveBeenCalled();
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 8,
      }),
    );
  });

  it('create 主账号操作时应使用自身 staffId 不按订单时间匹配班次员工', async () => {
    const orderDate = new Date(2026, 5, 4, 17, 30, 0);
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 1,
        countsTowardTotalQuantity: true,
      },
    ];

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
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
        paymentMethod: 'cash',
        calcMode: 'business',
        date: orderDate.getTime(),
      },
      {
        skipAccessCheck: true,
      },
    );

    expect(
      handoverPageShiftRecordService.findStartedUnhandedShiftRecord,
    ).not.toHaveBeenCalled();
    expect(
      handoverPageShiftRecordService.findCurrentShiftRecord,
    ).not.toHaveBeenCalled();
    expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorStaffId: 8,
        orderDate,
      }),
    );
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

  it('remove 会先清理退款流水与退款行，再删除已退款订单', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });
    transactionClient.saleOrderRefund.findUnique.mockResolvedValue({ id: 77 });

    await service.remove(user, 11);

    expect(transactionClient.saleOrderRefund.findUnique).toHaveBeenCalledWith({
      where: { saleOrderId: 11 },
      select: { id: true },
    });
    expect(
      transactionClient.financeCashFlowRecord.deleteMany,
    ).toHaveBeenCalledWith({ where: { saleOrderRefundId: 77 } });
    expect(transactionClient.saleOrderRefund.delete).toHaveBeenCalledWith({
      where: { id: 77 },
    });
    expect(transactionClient.saleOrder.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
  });

  it('remove 在无退款记录时不触碰退款表', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });
    transactionClient.saleOrderRefund.findUnique.mockResolvedValue(null);

    await service.remove(user, 11);

    expect(transactionClient.saleOrderRefund.delete).not.toHaveBeenCalled();
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
  /*
   * 幂等键：解决「服务端已提交、客户端没收到响应 → 用户重试 → 多出一单」。
   * 这里用真实 SalesRecordIdempotencyService，只把 Prisma 换成 mock，
   * 覆盖「回放 / 同 key 换内容 / 占位 / 失败清理 / 并发撞键」五条分支。
   */
  describe('Idempotency-Key', () => {
    const dto = {
      storeId: 18,
      items: [
        {
          productId: '201',
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: 15.5,
          profit: 4,
          quantity: 2,
        },
      ],
      paymentMethod: 'cash' as const,
      calcMode: 'business' as const,
    };
    const preparedItems = [
      {
        productId: 201,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: Money.fromInputYuan(15.5),
        profit: Money.fromInputYuan(4),
        quantity: 2,
        countsTowardTotalQuantity: true,
      },
    ];
    const createdResponse = { id: '11', orderNo: '#20260514-004' };
    const idempotencyKey = 'idem-0123456789';

    beforeEach(() => {
      commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
      commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
      salesRecordItemPreparationService.prepareItems.mockResolvedValue(
        preparedItems,
      );
      salesRecordCreateFlowService.createRecord.mockResolvedValue(
        createdResponse,
      );
      prismaService.idempotencyRecord.create.mockResolvedValue({ id: 77 });
      prismaService.idempotencyRecord.update.mockResolvedValue({});
      prismaService.idempotencyRecord.delete.mockResolvedValue({});
    });

    it('同一 key 命中已成功记录时直接回放，不建单也不读商品目录', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'succeeded',
        requestHash: idempotencyService.hashRequest({ storeId: 18, dto }),
        responseSnapshot: createdResponse,
      });

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).resolves.toEqual(createdResponse);

      expect(
        salesRecordItemPreparationService.prepareItems,
      ).not.toHaveBeenCalled();
      expect(salesRecordCreateFlowService.createRecord).not.toHaveBeenCalled();
      expect(prismaService.idempotencyRecord.create).not.toHaveBeenCalled();
    });

    it('同一 key 仍在处理中时返回 409，提示按同一 key 重试', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'processing',
        requestHash: idempotencyService.hashRequest({ storeId: 18, dto }),
        responseSnapshot: null,
      });

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(salesRecordCreateFlowService.createRecord).not.toHaveBeenCalled();
    });

    it('同一 key 换了订单内容时返回 409，绝不回放别的订单', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'succeeded',
        requestHash: 'another-request-hash',
        responseSnapshot: createdResponse,
      });

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('新 key 建单成功后回填幂等快照（关联销售单 ID）', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).resolves.toEqual(createdResponse);

      expect(prismaService.idempotencyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'processing' }),
        }),
      );
      expect(prismaService.idempotencyRecord.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: expect.objectContaining({
          status: 'succeeded',
          resourceType: 'sale_order',
          resourceId: 11,
        }),
      });
    });

    it('建单失败时清理占位，同一 key 可以重试探底', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue(null);
      salesRecordCreateFlowService.createRecord.mockRejectedValue(
        new ConflictException('库存不足'),
      );

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prismaService.idempotencyRecord.delete).toHaveBeenCalledWith({
        where: { id: 77 },
      });
      expect(prismaService.idempotencyRecord.update).not.toHaveBeenCalled();
    });

    it('并发双击撞唯一键时回读已有记录并回放', async () => {
      prismaService.idempotencyRecord.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          status: 'succeeded',
          requestHash: idempotencyService.hashRequest({ storeId: 18, dto }),
          responseSnapshot: createdResponse,
        });
      prismaService.idempotencyRecord.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(
        service.create(user, dto, { idempotencyKey }),
      ).resolves.toEqual(createdResponse);

      expect(salesRecordCreateFlowService.createRecord).not.toHaveBeenCalled();
    });

    it('未传 key 时保持原行为（不做任何幂等读写）', async () => {
      await service.create(user, dto);

      expect(prismaService.idempotencyRecord.findUnique).not.toHaveBeenCalled();
      expect(prismaService.idempotencyRecord.create).not.toHaveBeenCalled();
      expect(salesRecordCreateFlowService.createRecord).toHaveBeenCalledTimes(
        1,
      );
    });

    it('幂等键过短时 400，不落占位记录', async () => {
      await expect(
        service.create(user, dto, { idempotencyKey: 'short' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.idempotencyRecord.create).not.toHaveBeenCalled();
    });
  });
});
