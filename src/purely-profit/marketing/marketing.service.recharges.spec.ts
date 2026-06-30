import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService recharges', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listCustomerRecharges 返回顾客充值记录分页', async () => {
    context.prismaService.$queryRaw
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
          totalAmount: 12000,
          type: 'recharge',
          promotionId: 3,
          promotionName: '储值赠 20%',
          note: '活动储值',
          createdAt: new Date('2026-05-15T09:00:00.000Z'),
        },
      ]);
    context.prismaService.marketingRecharge.count.mockResolvedValue(1);

    const result = await context.service.listCustomerRecharges(
      context.user,
      9,
      {
        page: 1,
        pageSize: 20,
      },
    );

    expect(context.accessService.ensureCanAccess).toHaveBeenCalledWith(
      context.user,
      18,
      'marketing:view',
    );
    expect(result).toEqual({
      items: [
        {
          id: '100',
          customerId: '9',
          customerName: '张三',
          amount: 100,
          giftAmount: 20,
          totalAmount: 120,
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

  it('listCustomerRecharges 在顾客不存在时抛 NotFoundException', async () => {
    context.prismaService.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      context.service.listCustomerRecharges(context.user, 999, {
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createRecharge 退款超过余额时抛 BadRequestException', async () => {
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    context.prismaService.$queryRaw.mockResolvedValueOnce([
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
      context.service.createRecharge(context.user, 18, {
        customerId: 9,
        amount: 3000,
        type: 'refund',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Money 链路验证：充值 + 赠送 → totalAmount 由后端 Money.add 计算 ──

  it('createRecharge 正常充值：totalAmount = amount + giftAmount（Money 链路）', async () => {
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    // findCustomerOrThrow 返回
    context.prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 9,
        storeId: 18,
        name: '张三',
        phone: '13800138000',
        avatar: null,
        tier: 'gold',
        balance: 0,
        points: 300,
        totalSpent: 52000,
        visitCount: 6,
        lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
        remark: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);

    const createdRecharge = {
      id: 101,
      storeId: 18,
      customerId: 9,
      amount: 10000,    // 100 元 = 10000 分
      giftAmount: 2000, // 20 元 = 2000 分
      totalAmount: 12000, // Money.add → 120 元 = 12000 分
      type: 'recharge',
      promotionId: null,
      note: '测试储值',
    };
    context.prismaService.$transaction.mockImplementation(async (fn: Function) => {
      const txMock = {
        marketingRecharge: { create: jest.fn().mockResolvedValue(createdRecharge) },
        marketingCustomer: { update: jest.fn() },
        marketingPromotion: { updateMany: jest.fn() },
      };
      return fn(txMock);
    });
    // queryRechargeRowById 返回
    context.prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 101,
        customerId: 9,
        customerName: '张三',
        amount: 10000,
        giftAmount: 2000,
        totalAmount: 12000,
        type: 'recharge',
        promotionId: null,
        note: '测试储值',
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
      },
    ]);

    const result = await context.service.createRecharge(context.user, 18, {
      customerId: 9,
      amount: 10000,    // 分（DTO 单位）
      giftAmount: 2000, // 分
      note: '测试储值',
    });

    // 验证响应金额已通过 Money.fromDbCents → toOutputYuan 转换为元
    expect(result.amount).toBe(100);
    expect(result.giftAmount).toBe(20);
    expect(result.totalAmount).toBe(120);
  });

  it('createRecharge 退款：balanceDelta 为负值（Money.negate 链路）', async () => {
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    // findCustomerOrThrow 返回余额充足的顾客
    context.prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 9,
        storeId: 18,
        name: '张三',
        phone: '13800138000',
        avatar: null,
        tier: 'gold',
        balance: 50000, // 500 元余额
        points: 300,
        totalSpent: 52000,
        visitCount: 6,
        lastVisitAt: new Date('2026-05-14T10:00:00.000Z'),
        remark: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);

    const createdRecharge = {
      id: 102,
      storeId: 18,
      customerId: 9,
      amount: 3000,     // 30 元退款
      giftAmount: 0,
      totalAmount: 3000,
      type: 'refund',
      promotionId: null,
      note: '退款',
    };
    const txUpdateMock = jest.fn();
    const txFindUniqueMock = jest.fn().mockResolvedValue({ balance: 50000 });
    context.prismaService.$transaction.mockImplementation(async (fn: Function) => {
      const txMock = {
        marketingRecharge: { create: jest.fn().mockResolvedValue(createdRecharge) },
        marketingCustomer: { update: txUpdateMock, findUnique: txFindUniqueMock },
        marketingPromotion: { updateMany: jest.fn() },
      };
      return fn(txMock);
    });
    // queryRechargeRowById
    context.prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 102,
        customerId: 9,
        customerName: '张三',
        amount: 3000,
        giftAmount: 0,
        totalAmount: 3000,
        type: 'refund',
        promotionId: null,
        note: '退款',
        createdAt: new Date('2026-05-15T11:00:00.000Z'),
      },
    ]);

    const result = await context.service.createRecharge(context.user, 18, {
      customerId: 9,
      amount: 3000,
      type: 'refund',
      note: '退款',
    });

    expect(result.amount).toBe(30);
    expect(result.giftAmount).toBe(0);
    expect(result.totalAmount).toBe(30);
    expect(result.type).toBe('refund');
    // 验证余额扣减方向：退款时 balanceDelta = -3000（-30 元）
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balance: { increment: -3000 } },
      }),
    );
  });
});
