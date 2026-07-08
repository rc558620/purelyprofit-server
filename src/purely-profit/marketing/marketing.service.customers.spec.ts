import { ForbiddenException } from '@nestjs/common';
import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService customers', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listCustomers 返回顾客 status 衍生字段', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.prismaService.marketingCustomer.findMany.mockResolvedValue([
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
    context.prismaService.marketingCustomer.count.mockResolvedValue(1);

    const result = await context.service.listCustomers(context.user, {
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]?.status).toBe('active');
  });

  it('getCustomer 返回 totalRecharge 和最近记录', async () => {
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
          totalAmount: 12000,
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
      ])
      // 4th call: queryCustomerGiftBalanceCents（时间线遍历）
      .mockResolvedValueOnce([
        {
          amount: 10000,
          giftAmount: 2000,
          totalAmount: 12000,
          type: 'recharge',
        },
      ]);
    context.prismaService.marketingRecharge.aggregate
      // 1. recharge aggregate: _sum.amount
      .mockResolvedValueOnce({ _sum: { amount: 35000 } })
      // 2. refund aggregate: _sum.amount
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    context.clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue(
      {
        memberId: 201,
        storeId: 18,
        balance: 200,
        level: 'gold',
        points: 300,
        memberCode: 'PC202604010201',
        joinDate: '2026-04-01',
        totalConsume: 5200,
      },
    );
    context.clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue(
      {
        level: 'platinum',
        label: '铂金会员',
        color: '#9f67d4',
        bgColor: '#f3efff',
        requiredConsume: 5000,
        discountRate: 0.9,
        benefits: ['9 折会员专属价'],
      },
    );

    const result = await context.service.getCustomer(context.user, 9);

    expect(result.totalRecharge).toBe(350);
    // refundableAmount = 累计充值本金(350) - 累计退款(0) = 350
    expect(result.refundableAmount).toBe(350);
    // giftBalance: trackedGift = 2000（无退款，直接累计）= ¥20
    expect(result.giftBalance).toBe(20);
    expect(result.recentRecharges).toHaveLength(1);
    expect(result.recentConsumptions).toHaveLength(1);
    expect(result.phone).toBe('13800138000');
    expect(result.id).toBe('9');
    expect(result.registeredAt).toBe(
      new Date('2026-04-01T10:00:00.000Z').getTime(),
    );
    expect(result).not.toHaveProperty('createdAt');
    expect(result.status).toBe('active');
    expect(result.clubLevel).toBe('platinum');
    expect(result.clubLevelLabel).toBe('铂金会员');
    expect(
      context.clubMemberProfileService.getSnapshotByStoreAndPhone,
    ).toHaveBeenCalledWith(18, '13800138000');
    expect(
      context.clubMemberLevelsService.resolveCurrentLevelConfig,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 201, totalConsume: 5200 }),
    );
    expect(result.recentRecharges[0]).toEqual({
      id: '100',
      customerId: '9',
      customerName: '张三',
      amount: 100,
      giftAmount: 20,
      totalAmount: 120,
      type: 'recharge',
      promotionId: undefined,
      createdAt: new Date('2026-05-15T09:00:00.000Z').getTime(),
      note: '首次储值',
    });
    expect(result.recentConsumptions[0]).toEqual({
      id: '200',
      customerId: '9',
      amount: 38,
      balancePaid: 38,
      pointsDeducted: 0,
      payType: 'balance',
      itemsSummary: '拿铁 × 2',
      promotionId: undefined,
      createdAt: new Date('2026-05-15T10:00:00.000Z').getTime(),
    });
  });

  it('createCustomer 在会员不支持营销中心时拒绝新增顾客', async () => {
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockRejectedValue(
      new ForbiddenException('当前会员套餐暂不支持营销中心，请升级会员后使用'),
    );

    await expect(
      context.service.createCustomer(context.user, 18, {
        name: '张三',
        phone: '13800138000',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      context.prismaService.marketingCustomer.create,
    ).not.toHaveBeenCalled();
  });
});
