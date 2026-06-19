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

  /** 设置新增 8 类动态数据的默认 mock 返回值（全空/零值） */
  function setupEmptyNewActivityMocks(): void {
    prismaService.member.count.mockResolvedValue(0);
    prismaService.member.findMany.mockResolvedValue([]);
    prismaService.memberRechargeLog.findMany.mockResolvedValue([]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);
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
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledTimes(3);
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
        todayNewMemberCount: 0,
        todayRecharges: [],
        upcomingReservations: [],
        upcomingAccounts: [],
        draftPayrolls: [],
        inactiveVips: [],
        dailyRevenueRows: [],
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
        amount: 300,
        createdAt: new Date(2026, 4, 14, 14, 30, 0, 0),
      },
      {
        id: 21,
        amount: 200,
        createdAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
    ]);
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    prismaService.employeePayroll.findMany.mockResolvedValue([]);

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
          remaining: new Prisma.Decimal('1500.00'),
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
        actualSalary: new Prisma.Decimal('6000.00'),
        updatedAt: new Date(2026, 4, 14, 8, 0, 0, 0),
      },
    ]);

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

});
