import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingAccessService } from './marketing-access.service';
import { MarketingService } from './marketing.service';

describe('MarketingService', () => {
  let service: MarketingService;

  const prismaService = {
    marketingCustomer: {
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    marketingRecharge: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    marketingConsumption: {
      aggregate: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    marketingPromotion: {
      count: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const accessService = {
    resolveViewStoreId: jest.fn(),
    ensureCanAccess: jest.fn(),
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
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingService,
        { provide: PrismaService, useValue: prismaService },
        { provide: MarketingAccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get<MarketingService>(MarketingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getOverview 按前端首页契约返回纯储值概览和年度趋势', async () => {
    accessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.marketingCustomer.count.mockResolvedValueOnce(6);
    prismaService.marketingCustomer.aggregate.mockResolvedValue({
      _sum: { balance: 88000 },
    });
    prismaService.marketingRecharge.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100000, giftAmount: 10000 } })
      .mockResolvedValueOnce({ _sum: { amount: 20000, giftAmount: 3000 } })
      .mockResolvedValueOnce({ _sum: { amount: 50000, giftAmount: 5000 } });
    prismaService.marketingRecharge.count.mockResolvedValue(7);
    prismaService.marketingRecharge.findMany.mockResolvedValue([
      {
        createdAt: new Date('2025-03-05T08:00:00.000Z'),
        amount: 20000,
        giftAmount: 5000,
      },
      {
        createdAt: new Date('2026-02-10T10:00:00.000Z'),
        amount: 12000,
        giftAmount: 3000,
      },
      {
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
        amount: 10000,
        giftAmount: 2000,
      },
      {
        createdAt: new Date('2026-05-15T09:00:00.000Z'),
        amount: 8000,
        giftAmount: 0,
      },
    ]);

    const result = await service.getOverview(user, 18);

    expect(result).toEqual({
      totalBalance: 88000,
      totalRecharge: 110000,
      todayRecharge: 23000,
      thisMonthRecharge: 55000,
      rechargeCount: 7,
      activeMemberCount: 6,
      last30Days: expect.any(Array),
      currentYear: 2026,
      thisYearMonthlyTrend: [
        { label: '1月', amount: null },
        { label: '2月', amount: 15000 },
        { label: '3月', amount: null },
        { label: '4月', amount: null },
        { label: '5月', amount: 20000 },
        { label: '6月', amount: null },
        { label: '7月', amount: null },
        { label: '8月', amount: null },
        { label: '9月', amount: null },
        { label: '10月', amount: null },
        { label: '11月', amount: null },
        { label: '12月', amount: null },
      ],
      lastYearMonthlyTrend: [
        { label: '1月', amount: null },
        { label: '2月', amount: null },
        { label: '3月', amount: 25000 },
        { label: '4月', amount: null },
        { label: '5月', amount: null },
        { label: '6月', amount: null },
        { label: '7月', amount: null },
        { label: '8月', amount: null },
        { label: '9月', amount: null },
        { label: '10月', amount: null },
        { label: '11月', amount: null },
        { label: '12月', amount: null },
      ],
    });
    expect(result).not.toHaveProperty('totalCustomers');
    expect(result).not.toHaveProperty('newCustomersLast30d');
    expect(result).not.toHaveProperty('activeCustomers');
    expect(result).not.toHaveProperty('dormantCustomers');
    expect(result).not.toHaveProperty('lostCustomers');
    expect(result).not.toHaveProperty('consumptionThisMonth');
    expect(result).not.toHaveProperty('activePromotions');
    expect(result).not.toHaveProperty('tierDistribution');
    expect(result.last30Days).toHaveLength(30);
    expect(result.last30Days[result.last30Days.length - 2]).toEqual({
      date: '5/14',
      amount: 12000,
    });
    expect(result.last30Days[result.last30Days.length - 1]).toEqual({
      date: '5/15',
      amount: 8000,
    });
  });

  it('listCustomerRecharges 返回顾客充值记录分页', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 9,
          storeId: 18,
          name: '张三',
          phone: '13800138000',
          avatar: null,
          tier: 'gold',
          balance: 20000,
          points: 300,
          totalSpent: 52000,
          visitCount: 6,
          lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
          remark: null,
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-05-14T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 100,
          storeId: 18,
          customerId: 9,
          customerName: '张三',
          amount: 10000,
          giftAmount: 2000,
          type: 'recharge',
          promotionId: 3,
          promotionName: '储值赠 20%',
          note: '活动储值',
          createdAt: new Date('2026-05-15T09:00:00.000Z'),
        },
      ]);
    prismaService.marketingRecharge.count.mockResolvedValue(1);

    const result = await service.listCustomerRecharges(user, 9, {
      page: 1,
      pageSize: 20,
    });

    expect(accessService.ensureCanAccess).toHaveBeenCalledWith(
      user,
      18,
      'marketing:view',
    );
    expect(result).toEqual({
      items: [
        {
          id: '100',
          customerId: '9',
          amount: 10000,
          giftAmount: 2000,
          type: 'recharge',
          promotionId: '3',
          note: '活动储值',
          createdAt: new Date('2026-05-15T09:00:00.000Z').getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('listCustomers 和活动接口返回 status 衍生字段', async () => {
    accessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      {
        id: 9,
        storeId: 18,
        name: '张三',
        phone: '13800138000',
        avatar: null,
        tier: 'gold',
        balance: 20000,
        points: 300,
        totalSpent: 52000,
        visitCount: 6,
        lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
        remark: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);
    prismaService.marketingCustomer.count.mockResolvedValue(1);
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 3,
        storeId: 18,
        name: '储值赠 20%',
        type: 'recharge_gift',
        description: '充100送20',
        params: { rechargeAmount: 10000, giftRatio: 0.2 },
        startAt: new Date('2026-05-01T00:00:00.000Z'),
        endAt: new Date('2026-05-31T23:59:59.000Z'),
        usageCount: 3,
        totalDiscount: 6000,
        enabled: true,
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
      },
    ]);
    prismaService.marketingPromotion.count.mockResolvedValue(1);

    const customers = await service.listCustomers(user, { page: 1, pageSize: 20 });
    const promotions = await service.listPromotions(user, { page: 1, pageSize: 20 });

    expect(customers.items[0]?.status).toBe('active');
    expect(promotions.items[0]).toMatchObject({
      id: '3',
      status: 'active',
      enabled: true,
    });
  });

  it('getCustomer 返回 totalRecharge 和最近记录', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 9,
          storeId: 18,
          name: '张三',
          phone: '13800138000',
          avatar: null,
          tier: 'gold',
          balance: 20000,
          points: 300,
          totalSpent: 52000,
          visitCount: 6,
          lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
          remark: '老顾客',
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-05-14T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 100,
          storeId: 18,
          customerId: 9,
          customerName: '张三',
          amount: 10000,
          giftAmount: 2000,
          type: 'recharge',
          promotionId: null,
          promotionName: null,
          note: '首次储值',
          createdAt: new Date('2026-05-15T09:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 200,
          storeId: 18,
          customerId: 9,
          customerName: '张三',
          amount: 3800,
          balancePaid: 3800,
          pointsDeducted: 0,
          payType: 'balance',
          itemsSummary: '拿铁 × 2',
          promotionId: null,
          promotionName: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ]);
    prismaService.marketingRecharge.aggregate.mockResolvedValue({
      _sum: { amount: 30000, giftAmount: 5000 },
    });

    const result = await service.getCustomer(user, 9);

    expect(result.totalRecharge).toBe(35000);
    expect(result.recentRecharges).toHaveLength(1);
    expect(result.recentConsumptions).toHaveLength(1);
    expect(result.phone).toBe('138****8000');
    expect(result.id).toBe('9');
    expect(result.registeredAt).toBe(
      new Date('2026-04-01T10:00:00.000Z').getTime(),
    );
    expect(result).not.toHaveProperty('createdAt');
    expect(result.status).toBe('active');
    expect(result.recentRecharges[0]).toEqual({
      id: '100',
      customerId: '9',
      amount: 10000,
      giftAmount: 2000,
      type: 'recharge',
      createdAt: new Date('2026-05-15T09:00:00.000Z').getTime(),
      note: '首次储值',
    });
    expect(result.recentConsumptions[0]).toEqual({
      id: '200',
      customerId: '9',
      amount: 3800,
      balancePaid: 3800,
      pointsDeducted: 0,
      payType: 'balance',
      itemsSummary: '拿铁 × 2',
      createdAt: new Date('2026-05-15T10:00:00.000Z').getTime(),
    });
  });

  it('listCustomerRecharges 在顾客不存在时抛 NotFoundException', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      service.listCustomerRecharges(user, 999, { page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listPointsRecords 返回前端积分流水契约', async () => {
    accessService.resolveViewStoreId.mockResolvedValueOnce(18);
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 301,
          storeId: 18,
          customerId: 9,
          amount: -500,
          type: 'spend',
          description: '消费抵扣：商务套餐 × 2',
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await service.listPointsRecords(user, {
      page: 1,
      pageSize: 20,
      type: 'spend',
    });

    expect(result).toEqual({
      items: [
        {
          id: '301',
          customerId: '9',
          amount: -500,
          type: 'spend',
          description: '消费抵扣：商务套餐 × 2',
          createdAt: new Date('2026-05-15T10:00:00.000Z').getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('listCustomerPointsRecords 按顾客返回积分流水分页', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 9,
          storeId: 18,
          name: '张三',
          phone: '13800138000',
          avatar: null,
          tier: 'gold',
          balance: 20000,
          points: 300,
          totalSpent: 52000,
          visitCount: 6,
          lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
          remark: null,
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-05-14T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 302,
          storeId: 18,
          customerId: 9,
          amount: 200,
          type: 'gift',
          description: '活动赠送积分',
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }]);

    const result = await service.listCustomerPointsRecords(user, 9, {
      page: 1,
      pageSize: 20,
    });

    expect(accessService.ensureCanAccess).toHaveBeenCalledWith(
      user,
      18,
      'marketing:view',
    );
    expect(result.items[0]).toEqual({
      id: '302',
      customerId: '9',
      amount: 200,
      type: 'gift',
      description: '活动赠送积分',
      createdAt: new Date('2026-05-13T10:00:00.000Z').getTime(),
    });
  });

  it('createConsumption 在积分抵扣时写入 spend 积分流水', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 9,
          storeId: 18,
          name: '张三',
          phone: '13800138000',
          avatar: null,
          tier: 'gold',
          balance: 20000,
          points: 800,
          totalSpent: 52000,
          visitCount: 6,
          lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
          remark: null,
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-05-14T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 401,
          storeId: 18,
          customerId: 9,
          customerName: '张三',
          amount: 15800,
          balancePaid: 15800,
          pointsDeducted: 500,
          payType: 'balance',
          itemsSummary: '商务套餐 × 2',
          promotionId: null,
          promotionName: null,
          createdAt: new Date('2026-05-15T11:00:00.000Z'),
        },
      ]);

    const transactionClient = {
      marketingConsumption: {
        create: jest.fn().mockResolvedValue({ id: 401 }),
      },
      marketingCustomer: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      marketingPromotion: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prismaService.$transaction.mockImplementationOnce(async (callback) =>
      callback(transactionClient),
    );

    const result = await service.createConsumption(user, 18, {
      customerId: 9,
      amount: 15800,
      balancePaid: 15800,
      pointsDeducted: 500,
      payType: 'balance',
      itemsSummary: '商务套餐 × 2',
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: '401',
      customerId: '9',
      amount: 15800,
      balancePaid: 15800,
      pointsDeducted: 500,
      payType: 'balance',
      itemsSummary: '商务套餐 × 2',
      createdAt: new Date('2026-05-15T11:00:00.000Z').getTime(),
    });
  });

  it('createRecharge 退款超过余额时抛 BadRequestException', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 9,
        storeId: 18,
        name: '张三',
        phone: '13800138000',
        avatar: null,
        tier: 'gold',
        balance: 2000,
        points: 300,
        totalSpent: 52000,
        visitCount: 6,
        lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
        remark: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);

    await expect(
      service.createRecharge(user, 18, {
        customerId: 9,
        amount: 3000,
        type: 'refund',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
