import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SubjectCapabilityService } from '../../access-control/subject-capability.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
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
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
    writeRefreshableJson: jest.fn().mockResolvedValue(undefined),
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(2026, 4, 12, 0, 0, 0, 0),
    updatedAt: new Date(2026, 4, 13, 0, 0, 0, 0),
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

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 15, 0, 0, 0));
    jest.clearAllMocks();
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardHomeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
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
    prismaService.saleOrder.aggregate
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('220.00') },
        _count: { id: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('80.00') },
        _count: { id: 1 },
      });
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('30.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('20.00') },
      });
    prismaService.$queryRaw.mockResolvedValueOnce([
      {
        bucketAt: new Date(2026, 4, 14, 9, 0, 0, 0),
        revenue: new Prisma.Decimal('100.00'),
      },
      {
        bucketAt: new Date(2026, 4, 14, 13, 0, 0, 0),
        revenue: new Prisma.Decimal('120.00'),
      },
    ]);
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

    await expect(
      service.getOverview(user, { period: 'today' }),
    ).resolves.toEqual({
      stats: {
        profitLabel: '今日净利润 (元)',
        profit: 190,
        profitChange: 216.67,
        profitCompareLabel: '较昨日',
        orderLabel: '今日订单数',
        orderCount: 2,
        orderChange: 100,
        orderCompareLabel: '较昨日',
      },
      salesTrend: {
        title: '销售趋势图',
        categories: [
          '08:00',
          '10:00',
          '12:00',
          '14:00',
          '16:00',
          '18:00',
          '20:00',
          '22:00',
        ],
        actual: [100, 0, 120, 0, null, null, null, null],
        forecast: [null, null, null, null, 55, null, null, null],
        isYearMode: false,
        seriesNameActual: '实收',
        seriesNameForecast: '预测',
      },
      activities: [
        {
          id: 'sales-today',
          type: 'success',
          icon: 'sales',
          title: '今日销售额超昨日',
          time: '刚刚 · 环比 +175%',
          value: '+¥140',
          bizType: 'sales',
          actionUrl: '/sales-record',
          createdAt: new Date(2026, 4, 14, 15, 0, 0, 0).getTime(),
        },
        {
          id: 'inventory-5',
          type: 'warning',
          icon: 'inventory',
          title: '可乐 库存预警',
          time: '1小时前 · 系统',
          tag: '剩4件',
          bizType: 'inventory',
          bizId: '5',
          actionUrl: '/stocktaking',
          createdAt: new Date(2026, 4, 14, 14, 0, 0, 0).getTime(),
        },
        {
          id: 'finance-overdue',
          type: 'warning',
          icon: 'finance',
          title: '有1笔账款已逾期',
          time: '3小时前 · 财务管理',
          tag: '¥200',
          bizType: 'finance_account',
          bizId: '6',
          actionUrl: '/accounts-management',
          createdAt: new Date(2026, 4, 14, 12, 0, 0, 0).getTime(),
        },
        {
          id: 'marketing-active',
          type: 'info',
          icon: 'marketing',
          title: '当前有1个营销活动进行中',
          time: '4小时前 · 营销中心',
          tag: '至05/20',
          bizType: 'marketing_promotion',
          bizId: '7',
          actionUrl: '/marketing-center',
          createdAt: new Date(2026, 4, 14, 11, 0, 0, 0).getTime(),
        },
        {
          id: 'withdrawal-pending',
          type: 'info',
          icon: 'withdrawal',
          title: '有1笔提现待处理',
          time: '5小时前 · 会员中心',
          tag: '待审300豆',
          bizType: 'withdrawal',
          bizId: '8',
          actionUrl: '/member-center',
          createdAt: new Date(2026, 4, 14, 10, 0, 0, 0).getTime(),
        },
        {
          id: 'employee-leave-9',
          type: 'info',
          icon: 'employee',
          title: '小李事假即将开始',
          time: '6小时前 · 员工管理',
          tag: '2天',
          bizType: 'employee_leave',
          bizId: '9',
          actionUrl: '/employee-management',
          createdAt: new Date(2026, 4, 14, 9, 0, 0, 0).getTime(),
        },
      ],
      capability: {
        identityType: 'owner',
        subAccountRole: undefined,
        subAccountRoleLabel: undefined,
        subAccountAssigned: false,
        canAccessHome: true,
        canUseHandover: false,
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
        canAccessDashboardOverview: true,
      },
      meta: {
        period: 'today',
        storeId: 18,
        storeName: '纯利宝测试门店',
        startAt: new Date(2026, 4, 14, 0, 0, 0, 0).getTime(),
        endAt: new Date(2026, 4, 14, 15, 0, 0, 0).getTime(),
        compareStartAt: new Date(2026, 4, 13, 0, 0, 0, 0).getTime(),
        compareEndAt: new Date(2026, 4, 13, 15, 0, 0, 0).getTime(),
        generatedAt: new Date(2026, 4, 14, 15, 0, 0, 0).getTime(),
      },
    });
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 18,
        dueDate: { lt: new Date(2026, 4, 14, 15, 0, 0, 0) },
        paidAmount: new Prisma.Decimal(0),
        remaining: { gt: new Prisma.Decimal(0) },
      }),
      select: {
        id: true,
        counterpart: true,
        remaining: true,
        dueDate: true,
        updatedAt: true,
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledTimes(3);
  });

  it('getOverview 不会把部分已收付的过期账款视为首页逾期提醒', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.store.findUnique.mockResolvedValue({
      name: '纯利宝测试门店',
    });
    prismaService.saleOrder.aggregate
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('0.00') },
        _count: { id: 0 },
      })
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('0.00') },
        _count: { id: 0 },
      });
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('0.00') },
      });
    prismaService.$queryRaw.mockResolvedValueOnce([]);
    prismaService.product.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([]);
    prismaService.employeeLeave.findMany.mockResolvedValue([]);

    const result = await service.getOverview(user, { period: 'today' });

    expect(
      result.activities.some((item) => item.id === 'finance-overdue'),
    ).toBe(false);
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 18,
        dueDate: { lt: new Date(2026, 4, 14, 15, 0, 0, 0) },
        paidAmount: new Prisma.Decimal(0),
        remaining: { gt: new Prisma.Decimal(0) },
      }),
      select: {
        id: true,
        counterpart: true,
        remaining: true,
        dueDate: true,
        updatedAt: true,
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    });
  });

  it('cashier 首页能力开放时允许通过 operation-entry:view 访问概览接口', async () => {
    const cashierUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        ...user.currentMembership!,
        role: 'STAFF',
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
    redisService.getOrLoadRefreshableJson
      .mockResolvedValueOnce({
        store: { name: '纯利宝测试门店' },
        currentSales: { revenue: 0, orderCount: 0 },
        compareSales: { revenue: 0, orderCount: 0 },
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
});
