import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SubjectCapabilityService } from '../../access-control/subject-capability.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { DashboardHomeService } from './dashboard-home.service';

describe('DashboardHomeService', () => {
  let service: DashboardHomeService;

  const prismaService = {
    $queryRaw: jest.fn(),
    store: {
      findUnique: jest.fn(),
    },
    saleOrder: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    costRecord: {
      aggregate: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    financeAccountRecord: {
      findMany: jest.fn(),
    },
    marketingPromotion: {
      findMany: jest.fn(),
    },
    partnerWithdrawal: {
      findMany: jest.fn(),
    },
    employeeLeave: {
      findMany: jest.fn(),
    },
    member: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    memberRechargeLog: {
      findMany: jest.fn(),
    },
    spaceReservation: {
      findMany: jest.fn(),
    },
    employeePayroll: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const redisService = {
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
    writeRefreshableJson: jest.fn().mockResolvedValue(undefined),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(2026, 4, 12, 0, 0, 0, 0),
    updatedAt: new Date(2026, 4, 13, 0, 0, 0, 0),
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
      canUseHandover: false,
    },
  };

  const subjectCapabilityService = {
    buildSnapshot: jest.fn().mockReturnValue({
      identityType: 'owner',
      subAccountRole: null,
      subAccountRoleLabel: null,
      subAccountQuota: 0,
      subAccountEnabled: false,
      allowedHomeModules: [
        'additional',
        'business-analysis',
        'finance-center',
        'goods-management',
        'handover-management',
        'marketing-center',
        'member-center',
        'space-management',
        'staff-management',
        'store-settings',
      ],
      hiddenHomeModules: [],
      canViewFinance: true,
      canViewMarketing: true,
      canUseGoodsManagement: true,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: true,
    }),
  };

  const storeSubAccountService = {
    getStoreSubAccountSummary: jest.fn().mockResolvedValue({
      quota: 0,
      usedCount: 0,
      availableCount: 0,
      roleSummary: [],
      slots: [],
    }),
  };

  /** 设置新增 8 类动态数据的默认 mock 返回值（全空/零值） */
  function setupEmptyNewActivityMocks(): void {
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);
  }

  /** 设置新增 8 类动态数据的有值 mock 返回值 */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setupNonEmptyNewActivityMocks(): void {
    prismaService.member.count.mockResolvedValue(3);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([
      {
        id: 10,
        amount: 500,
        createdAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
    ]);
    prismaService.spaceReservation.findMany.mockResolvedValue([
      {
        id: 11,
        spaceId: 7,
        guestName: '张三',
        reservedAt: new Date(2026, 4, 14, 16, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 10, 0, 0, 0),
      },
    ]);
    // 即将到期账款 —— 复用 overdueAccounts 的查询，额外再返回一组 upcoming
    prismaService.financeAccountRecord.findMany
      // 第一次调用：overdueAccounts
      .mockResolvedValueOnce([
        {
          id: 6,
          counterpart: '张三供应商',
          remaining: new Prisma.Decimal('200.00'),
          dueDate: new Date(2026, 4, 13, 0, 0, 0, 0),
          updatedAt: new Date(2026, 4, 14, 12, 0, 0, 0),
        },
      ])
      // 第二次调用：upcomingAccounts
      .mockResolvedValueOnce([
        {
          id: 15,
          counterpart: '李四供应商',
          remaining: new Prisma.Decimal('800.00'),
          dueDate: new Date(2026, 4, 18, 0, 0, 0, 0),
          updatedAt: new Date(2026, 4, 14, 11, 0, 0, 0),
        },
      ]);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 16,
        employeeName: '王五',
        month: '2026-05',
        actualSalary: new Prisma.Decimal('5000.00'),
        updatedAt: new Date(2026, 4, 14, 9, 0, 0, 0),
      },
    ]);
    // 高价值会员久未到店 —— 已在上面 mock 了 member.count，此处不再覆盖
    // 营收趋势 —— 返回连续 3 天下滑数据
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('220.00'),
          order_count: BigInt(2),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('80.00'),
          order_count: BigInt(1),
        },
      ])
      // trend rows
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 14, 9, 0, 0, 0),
          revenue: new Prisma.Decimal('100.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 13, 0, 0, 0),
          revenue: new Prisma.Decimal('120.00'),
        },
      ])
      .mockResolvedValueOnce([]) // inactiveVips
      // daily revenue rows for decline detection
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 11, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('500.00'),
        },
        {
          bucketAt: new Date(2026, 4, 12, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('400.00'),
        },
        {
          bucketAt: new Date(2026, 4, 13, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('300.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('200.00'),
        },
      ]);
  }

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 15, 0, 0, 0));
    jest.clearAllMocks();
    refreshableCache.getOrLoadRefreshableJson.mockImplementation(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardHomeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: RefreshableCacheService, useValue: refreshableCache },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SubjectCapabilityService,
          useValue: subjectCapabilityService,
        },
        { provide: StoreSubAccountService, useValue: storeSubAccountService },
      ],
    }).compile();

    service = module.get<DashboardHomeService>(DashboardHomeService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getOverview 返回首页概览所需字段', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('220.00'),
          order_count: BigInt(2),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('80.00'),
          order_count: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 14, 9, 0, 0, 0),
          revenue: new Prisma.Decimal('100.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 13, 0, 0, 0),
          revenue: new Prisma.Decimal('120.00'),
        },
      ])
      .mockResolvedValueOnce([]) // inactiveVips
      // daily revenue rows（无下滑）
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 13, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('100.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('220.00'),
        },
      ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('30.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('20.00') },
      });
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 5,
        name: '可乐',
        stock: 4,
        alertThreshold: 10,
        updatedAt: new Date(2026, 4, 14, 14, 0, 0, 0),
      },
    ]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 6,
        counterpart: '张三供应商',
        remaining: new Prisma.Decimal('200.00'),
        dueDate: new Date(2026, 4, 13, 0, 0, 0, 0),
        updatedAt: new Date(2026, 4, 14, 12, 0, 0, 0),
      },
    ]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 7,
        name: '夏日活动',
        endAt: new Date(2026, 4, 20, 23, 59, 59, 999),
        updatedAt: new Date(2026, 4, 14, 11, 0, 0, 0),
      },
    ]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([
      {
        id: 8,
        beanAmount: 300,
        appliedAt: new Date(2026, 4, 14, 10, 0, 0, 0),
      },
    ]);
    prismaService.employeeLeave.findMany.mockResolvedValue([
      {
        id: 9,
        employeeName: '小李',
        type: 'personal',
        startDate: new Date(2026, 4, 15, 9, 0, 0, 0),
        days: new Prisma.Decimal('2.00'),
        createdAt: new Date(2026, 4, 14, 9, 0, 0, 0),
      },
    ]);
    // 新增动态：今日新增会员
    prismaService.member.count.mockResolvedValue(2);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    expect(result.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sales-today',
          type: 'success',
          icon: 'sales',
        }),
        expect.objectContaining({
          id: 'inventory-5',
          type: 'warning',
          icon: 'inventory',
        }),
        expect.objectContaining({
          id: 'finance-overdue',
          type: 'warning',
          icon: 'finance',
        }),
        expect.objectContaining({
          id: 'marketing-active',
          type: 'info',
          icon: 'marketing',
        }),
        expect.objectContaining({
          id: 'withdrawal-pending',
          type: 'info',
          icon: 'withdrawal',
        }),
        expect.objectContaining({
          id: 'employee-leave-9',
          type: 'info',
          icon: 'employee',
        }),
        expect.objectContaining({
          id: 'member-today-new',
          type: 'success',
          icon: 'member',
          title: '今日新增2位会员',
        }),
      ]),
    );
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledTimes(
      2,
    );
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledTimes(3);
  });

  it('getOverview 不会把部分已收付的过期账款视为首页逾期提醒', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    expect(
      result.activities.some((item) => item.id === 'finance-overdue'),
    ).toBe(false);
    expect(
      result.activities.some((item) => item.id === 'finance-upcoming-due'),
    ).toBe(false);
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledTimes(
      2,
    );
  });

  it('cashier 首页能力开放时允许通过 operation-entry:view 访问概览接口', async () => {
    const cashierUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        ...user.currentMembership!,
        role: 'staff',
        permissions: ['operation-entry:view'],
        subjectType: 'sub_account',
        linkedEmployeeId: 12,
        subAccountId: 3,
        subAccountRole: 'cashier',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    refreshableCache.getOrLoadRefreshableJson
      .mockResolvedValueOnce({
        store: { name: '纯利宝测试门店' },
        currentSales: { revenue: 0, profit: 0, orderCount: 0 },
        compareSales: { revenue: 0, profit: 0, orderCount: 0 },
        currentCosts: { totalCost: 0 },
        compareCosts: { totalCost: 0 },
      })
      .mockResolvedValueOnce({
        title: '销售趋势图',
        categories: [],
        actual: [],
        forecast: [],
        isYearMode: false,
        seriesNameActual: '实收',
        seriesNameForecast: '预测',
      })
      .mockResolvedValueOnce({
        lowStockProducts: [],
        overdueAccounts: [],
        activePromotions: [],
        pendingWithdrawals: [],
        upcomingLeaves: [],
        todayNewMemberCount: 0,
        todayRecharges: [],
        upcomingReservations: [],
        upcomingAccounts: [],
        draftPayrolls: [],
        inactiveVips: [],
        dailyRevenueRows: [],
        recentOrders: [],
      });
    storeSubAccountService.getStoreSubAccountSummary.mockResolvedValue({
      quota: 3,
      usedCount: 1,
      availableCount: 2,
      roleSummary: [],
      slots: [],
    });
    subjectCapabilityService.buildSnapshot.mockReturnValue({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountQuota: 3,
      subAccountEnabled: true,
      allowedHomeModules: [
        'additional',
        'space-management',
        'handover-management',
      ],
      hiddenHomeModules: [
        'business-analysis',
        'finance-center',
        'goods-management',
        'marketing-center',
        'member-center',
        'staff-management',
        'store-settings',
      ],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    });

    const result = await service.getOverview(cashierUser, { period: 'today' });

    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      cashierUser,
      undefined,
      'operation-entry:view',
      '无权查看该门店首页概览',
    );
    expect(result.capability).toMatchObject({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: true,
      canAccessDashboardOverview: true,
    });
  });

  it('今日充值动态正确展示充值金额', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([
      {
        id: 20,
        amount: 30000,
        createdAt: new Date(2026, 4, 14, 14, 30, 0, 0),
      },
      {
        id: 21,
        amount: 20000,
        createdAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
    ]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    const rechargeActivity = result.activities.find(
      (item) => item.id === 'member-today-recharge',
    );
    expect(rechargeActivity).toBeDefined();
    expect(rechargeActivity!.title).toBe('今日新增2笔充值');
    expect(rechargeActivity!.tag).toBe('¥500');
  });

  it('即将到期账款动态正确展示', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    // 第一次 overdueAccounts 返回空，第二次 upcomingAccounts 有数据
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 30,
          counterpart: '王五供应商',
          remaining: 150000,
          dueDate: new Date(2026, 4, 18, 0, 0, 0, 0),
          updatedAt: new Date(2026, 4, 14, 10, 0, 0, 0),
        },
      ]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    const upcomingActivity = result.activities.find(
      (item) => item.id === 'finance-upcoming-due',
    );
    expect(upcomingActivity).toBeDefined();
    expect(upcomingActivity!.title).toBe('有1笔账款即将到期');
    expect(upcomingActivity!.tag).toBe('¥1500');
    expect(upcomingActivity!.bizType).toBe('finance_account_upcoming');
  });

  it('待确认工资单动态正确展示', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 40,
        employeeName: '赵六',
        month: '2026-05',
        actualSalary: 600000,
        updatedAt: new Date(2026, 4, 14, 8, 0, 0, 0),
      },
    ]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    const payrollActivity = result.activities.find(
      (item) => item.id === 'employee-payroll-draft',
    );
    expect(payrollActivity).toBeDefined();
    expect(payrollActivity!.title).toBe('有1份工资单待确认');
    expect(payrollActivity!.tag).toBe('¥6000');
    expect(payrollActivity!.icon).toBe('employee');
  });

  it('预约即将开始动态正确展示剩余分钟', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([
      {
        id: 55,
        spaceId: 7,
        guestName: '周七',
        reservedAt: new Date(2026, 4, 14, 16, 30, 0, 0),
        createdAt: new Date(2026, 4, 14, 10, 0, 0, 0),
      },
    ]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    const reservationActivity = result.activities.find(
      (item) => item.id === 'space-reservation-55',
    );
    expect(reservationActivity).toBeDefined();
    expect(reservationActivity!.title).toBe('周七的预约即将开始');
    expect(reservationActivity!.icon).toBe('space');
    expect(reservationActivity!.bizType).toBe('space_reservation');
    // 当前时间 15:00，预约 16:30，剩余 90 分钟
    expect(reservationActivity!.time).toContain('分钟后');
  });

  // ---- BUG 修复验证测试 ----

  it('BUG-1: formatRelativeTime 超过24小时返回中文文案而非英文 today', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    // 逾期账款 updatedAt 在 2 天前，超过 24 小时
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 99,
          counterpart: '远方供应商',
          remaining: new Prisma.Decimal('500.00'),
          dueDate: new Date(2026, 4, 10, 0, 0, 0, 0),
          // 5月12日的 updatedAt，距今超过 24 小时
          updatedAt: new Date(2026, 4, 12, 10, 0, 0, 0),
        },
      ])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    const overdueActivity = result.activities.find(
      (item) => item.id === 'finance-overdue',
    );
    expect(overdueActivity).toBeDefined();
    // 不应包含英文 'today'，应包含 '天前' 或 '小时前' 等中文
    expect(overdueActivity!.time).not.toContain('today');
    expect(overdueActivity!.time).toMatch(/天前|小时前|刚刚/);
  });

  it('BUG-2: detectRevenueDecline 真正的下滑趋势被正确检测', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      // daily revenue rows：连续 3 天下滑 500→400→300→200
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 11, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('500.00'),
        },
        {
          bucketAt: new Date(2026, 4, 12, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('400.00'),
        },
        {
          bucketAt: new Date(2026, 4, 13, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('300.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('200.00'),
        },
      ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    const declineActivity = result.activities.find(
      (item) => item.id === 'sales-revenue-decline',
    );
    expect(declineActivity).toBeDefined();
    expect(declineActivity!.type).toBe('warning');
    expect(declineActivity!.title).toContain('连续3天下滑');
  });

  it('BUG-2: detectRevenueDecline 增长趋势不被误判为下滑', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      // daily revenue rows：连续增长 200→300→400→500
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 11, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('200.00'),
        },
        {
          bucketAt: new Date(2026, 4, 12, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('300.00'),
        },
        {
          bucketAt: new Date(2026, 4, 13, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('400.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('500.00'),
        },
      ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    const declineActivity = result.activities.find(
      (item) => item.id === 'sales-revenue-decline',
    );
    // 增长趋势不应产生下滑提醒
    expect(declineActivity).toBeUndefined();
  });

  it('BUG-3: detectRevenueDecline 缺失天数不触发误报下滑', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      // 只有今天和昨天有数据，中间缺失的不应算作下滑
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 13, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('500.00'),
        },
        {
          bucketAt: new Date(2026, 4, 14, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('300.00'),
        },
      ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    setupEmptyNewActivityMocks();

    const result = await service.getOverview(user, { period: 'today' });

    const declineActivity = result.activities.find(
      (item) => item.id === 'sales-revenue-decline',
    );
    // 只有两个数据点（1次下降），不满足连续3天下滑
    expect(declineActivity).toBeUndefined();
  });

  it('BUG-6: lastConsumeAt 为 null 时不崩溃且天数合理', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('0.00'),
          order_count: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([])
      // inactiveVips: lastConsumeAt 为 null 的高价值会员（level 来自 mc.tier 映射：diamond→annual）
      .mockResolvedValueOnce([
        {
          id: 77,
          name: '从未消费会员',
          level: 'annual',
          lastConsumeAt: null,
          updatedAt: new Date(2026, 4, 14, 10, 0, 0, 0),
        },
      ])
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    const vipActivity = result.activities.find(
      (item) => item.id === 'member-inactive-vip',
    );
    expect(vipActivity).toBeDefined();
    // 不应出现荒谬的天数（如 20731 天），应该 fallback 到 VIP_INACTIVE_THRESHOLD_DAYS (30)
    expect(vipActivity!.time).not.toContain('20731');
    expect(vipActivity!.time).toContain('30天');
  });

  // ---- 订单实时更新动态测试 ----

  it('最近2小时内有订单时生成订单动态', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    // 最近 2 小时内有 5 笔订单（当前时间 15:00）
    prismaService.saleOrder.findMany.mockResolvedValueOnce([
      {
        id: 101,
        totalRevenue: 15800,
        date: new Date(2026, 4, 14, 14, 32, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 32, 0, 0),
      },
      {
        id: 102,
        totalRevenue: 8950,
        date: new Date(2026, 4, 14, 13, 15, 0, 0),
        createdAt: new Date(2026, 4, 14, 13, 15, 0, 0),
      },
      {
        id: 103,
        totalRevenue: 22000,
        date: new Date(2026, 4, 14, 13, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
      {
        id: 104,
        totalRevenue: 4500,
        date: new Date(2026, 4, 14, 12, 30, 0, 0),
        createdAt: new Date(2026, 4, 14, 12, 30, 0, 0),
      },
      {
        id: 105,
        totalRevenue: 31280,
        date: new Date(2026, 4, 14, 12, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 12, 0, 0, 0),
      },
    ]);

    const result = await service.getOverview(user, { period: 'today' });

    const orderActivities = result.activities.filter((a) =>
      a.id.startsWith('sales-order-'),
    );
    expect(orderActivities.length).toBe(5);

    // 验证第一条订单动态格式
    const firstOrder = orderActivities.find((a) => a.id === 'sales-order-101');
    expect(firstOrder).toBeDefined();
    expect(firstOrder!.type).toBe('success');
    expect(firstOrder!.icon).toBe('sales');
    expect(firstOrder!.title).toBe('订单完成');
    expect(firstOrder!.time).toBe('14:32 · 销售记录');
    expect(firstOrder!.value).toBe('+¥158');
    expect(firstOrder!.bizType).toBe('sales_order');
    expect(firstOrder!.bizId).toBe('101');
    expect(firstOrder!.actionUrl).toBe('/sales-record');

    // 验证小数金额
    const secondOrder = orderActivities.find((a) => a.id === 'sales-order-102');
    expect(secondOrder!.value).toBe('+¥89.5');

    // 验证两小数金额
    const fifthOrder = orderActivities.find((a) => a.id === 'sales-order-105');
    expect(fifthOrder!.value).toBe('+¥312.8');

    // 只查一次（2小时内够数，不需要补今日）
    expect(prismaService.saleOrder.findMany).toHaveBeenCalledTimes(1);
  });

  it('最近2小时内订单不足时补今日订单且不重复', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    // 最近 2 小时内只有 1 笔订单
    prismaService.saleOrder.findMany
      .mockResolvedValueOnce([
        {
          id: 201,
          totalRevenue: new Prisma.Decimal('88.00'),
          date: new Date(2026, 4, 14, 14, 0, 0, 0),
          createdAt: new Date(2026, 4, 14, 14, 0, 0, 0),
        },
      ])
      // 补今日订单（不含 id=201）
      .mockResolvedValueOnce([
        {
          id: 202,
          totalRevenue: new Prisma.Decimal('156.00'),
          date: new Date(2026, 4, 14, 10, 30, 0, 0),
          createdAt: new Date(2026, 4, 14, 10, 30, 0, 0),
        },
        {
          id: 203,
          totalRevenue: new Prisma.Decimal('72.00'),
          date: new Date(2026, 4, 14, 9, 15, 0, 0),
          createdAt: new Date(2026, 4, 14, 9, 15, 0, 0),
        },
        {
          id: 204,
          totalRevenue: new Prisma.Decimal('200.00'),
          date: new Date(2026, 4, 14, 8, 30, 0, 0),
          createdAt: new Date(2026, 4, 14, 8, 30, 0, 0),
        },
      ]);

    const result = await service.getOverview(user, { period: 'today' });

    const orderActivities = result.activities.filter((a) =>
      a.id.startsWith('sales-order-'),
    );
    // 1 + 3 = 4 笔
    expect(orderActivities.length).toBe(4);

    // 不应有重复
    const ids = orderActivities.map((a) => a.bizId);
    expect(new Set(ids).size).toBe(ids.length);

    // 补今日时排除了已取到的 id=201
    expect(prismaService.saleOrder.findMany).toHaveBeenCalledTimes(2);
    const secondCallWhere =
      prismaService.saleOrder.findMany.mock.calls[1][0].where;
    expect(secondCallWhere.id.notIn).toContain(201);

    // 合并后按 createdAt 倒序
    const createdAtValues = orderActivities.map((a) => a.createdAt);
    for (let i = 1; i < createdAtValues.length; i++) {
      expect(createdAtValues[i - 1]).toBeGreaterThanOrEqual(createdAtValues[i]);
    }
  });

  it('没有订单时不生成订单动态也不报错', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    // 2 小时内无订单
    prismaService.saleOrder.findMany
      .mockResolvedValueOnce([])
      // 补今日也无订单
      .mockResolvedValueOnce([]);

    const result = await service.getOverview(user, { period: 'today' });

    const orderActivities = result.activities.filter((a) =>
      a.id.startsWith('sales-order-'),
    );
    expect(orderActivities.length).toBe(0);
    // 不应抛错
    expect(result.activities).toBeDefined();
  });

  it('订单动态与其它动态一起按 createdAt 倒序排序', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('100.00'), order_count: BigInt(1) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('50.00'), order_count: BigInt(1) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 5,
        name: '可乐',
        stock: 4,
        alertThreshold: 10,
        updatedAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
    ]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValueOnce([
      {
        id: 301,
        totalRevenue: new Prisma.Decimal('158.00'),
        date: new Date(2026, 4, 14, 14, 32, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 32, 0, 0),
      },
    ]);

    const result = await service.getOverview(user, { period: 'today' });

    // 所有动态应按 createdAt 倒序
    for (let i = 1; i < result.activities.length; i++) {
      expect(result.activities[i - 1].createdAt).toBeGreaterThanOrEqual(
        result.activities[i].createdAt,
      );
    }

    // 订单动态存在
    const orderActivity = result.activities.find(
      (a) => a.id === 'sales-order-301',
    );
    expect(orderActivity).toBeDefined();
    expect(orderActivity!.title).toBe('订单完成');
  });

  it('订单动态总数仍受 MAX_HOME_ACTIVITY_COUNT 限制', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('100.00'), order_count: BigInt(1) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('50.00'), order_count: BigInt(1) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 5,
        name: '可乐',
        stock: 4,
        alertThreshold: 10,
        updatedAt: new Date(2026, 4, 14, 14, 0, 0, 0),
      },
    ]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 6,
          counterpart: '张三供应商',
          remaining: new Prisma.Decimal('200.00'),
          dueDate: new Date(2026, 4, 13, 0, 0, 0, 0),
          updatedAt: new Date(2026, 4, 14, 13, 0, 0, 0),
        },
      ])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 7,
        name: '夏日活动',
        endAt: new Date(2026, 4, 20, 23, 59, 59, 999),
        updatedAt: new Date(2026, 4, 14, 11, 0, 0, 0),
      },
    ]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([
      {
        id: 8,
        beanAmount: 300,
        appliedAt: new Date(2026, 4, 14, 10, 0, 0, 0),
      },
    ]);
    prismaService.employeeLeave.findMany.mockResolvedValue([
      {
        id: 9,
        employeeName: '小李',
        type: 'personal',
        startDate: new Date(2026, 4, 15, 9, 0, 0, 0),
        days: new Prisma.Decimal('2.00'),
        createdAt: new Date(2026, 4, 14, 9, 0, 0, 0),
      },
    ]);
    prismaService.member.count.mockResolvedValue(2);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    // 6 笔订单
    prismaService.saleOrder.findMany.mockResolvedValueOnce([
      {
        id: 401,
        totalRevenue: new Prisma.Decimal('100.00'),
        date: new Date(2026, 4, 14, 14, 50, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 50, 0, 0),
      },
      {
        id: 402,
        totalRevenue: new Prisma.Decimal('80.00'),
        date: new Date(2026, 4, 14, 14, 30, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 30, 0, 0),
      },
      {
        id: 403,
        totalRevenue: new Prisma.Decimal('200.00'),
        date: new Date(2026, 4, 14, 14, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 0, 0, 0),
      },
      {
        id: 404,
        totalRevenue: new Prisma.Decimal('60.00'),
        date: new Date(2026, 4, 14, 13, 30, 0, 0),
        createdAt: new Date(2026, 4, 14, 13, 30, 0, 0),
      },
      {
        id: 405,
        totalRevenue: new Prisma.Decimal('150.00'),
        date: new Date(2026, 4, 14, 13, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
      {
        id: 406,
        totalRevenue: new Prisma.Decimal('90.00'),
        date: new Date(2026, 4, 14, 12, 30, 0, 0),
        createdAt: new Date(2026, 4, 14, 12, 30, 0, 0),
      },
    ]);

    const result = await service.getOverview(user, { period: 'today' });

    // 总数受 MAX_HOME_ACTIVITY_COUNT (8) 限制
    expect(result.activities.length).toBeLessThanOrEqual(8);
  });

  it('订单金额为 0 或 null 时不生成订单动态', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { revenue: new Prisma.Decimal('0.00'), order_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // inactiveVips
      .mockResolvedValueOnce([]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.00') } });
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValueOnce([
      {
        id: 501,
        totalRevenue: new Prisma.Decimal('0.00'),
        date: new Date(2026, 4, 14, 14, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 14, 0, 0, 0),
      },
    ]);

    const result = await service.getOverview(user, { period: 'today' });

    // 0 金额订单不应生成动态
    const orderActivity = result.activities.find(
      (a) => a.id === 'sales-order-501',
    );
    expect(orderActivity).toBeUndefined();
    // 不应抛错
    expect(result.activities).toBeDefined();
  });
});
