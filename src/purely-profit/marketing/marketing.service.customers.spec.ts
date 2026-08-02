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
    // F9: 默认 groupBy 行为（mockResolvedValue([])）保持物化字段不变

    const result = await context.service.listCustomers(context.user, {
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]?.status).toBe('active');
    // 没有消费聚合记录时，透传物化字段值
    expect(result.items[0]?.totalSpent).toBe(520);
    expect(result.items[0]?.visitCount).toBe(6);
  });

  it('listCustomers 在物化字段与消费记录不一致时以实时聚合为准（F9 修复场景）', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    // 模拟历史数据：物化字段 totalSpent 有值但 visitCount 为 0（金额高、次数为 0 的脏数据）
    context.prismaService.marketingCustomer.findMany.mockResolvedValue([
      {
        id: 9,
        storeId: 18,
        name: 'Jeffrey',
        phone: '13919654010',
        avatar: null,
        tier: 'gold',
        balance: 0,
        points: 0,
        totalSpent: 22190800, // ¥221,908.00（脏：可能来自迁移）
        visitCount: 0, // ❌ 但次数是 0
        lastVisitAt: new Date('2025-01-01T00:00:00.000Z'), // 旧时间
        remark: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]);
    context.prismaService.marketingCustomer.count.mockResolvedValue(1);
    // 真实消费表里有 128 笔消费，总额与最近消费时间
    context.prismaService.marketingConsumption.groupBy.mockResolvedValueOnce([
      {
        customerId: 9,
        _sum: { amount: 2219080 }, // ¥22,190.80（与截图一致）
        _count: { _all: 128 },
        _max: {
          createdAt: new Date('2026-05-15T11:30:00.000Z'), // 最近一次消费
        },
      },
    ]);

    const result = await context.service.listCustomers(context.user, {
      page: 1,
      pageSize: 20,
    });

    // 验证：消费金额 / 次数 / 最后消费时间都从 marketing_consumptions 实时聚合
    expect(result.items[0]?.totalSpent).toBe(22190.8);
    expect(result.items[0]?.visitCount).toBe(128);
    expect(result.items[0]?.lastVisitAt).toBe(
      new Date('2026-05-15T11:30:00.000Z').getTime(),
    );
  });

  it('listCustomers 在消费表无记录时不强制归零（孤儿 customer 保护）', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    // 物化字段已有值但消费表里没有任何记录（孤儿 customer，可能是手动录入）
    context.prismaService.marketingCustomer.findMany.mockResolvedValue([
      {
        id: 9,
        storeId: 18,
        name: '老会员',
        phone: '13800138000',
        avatar: null,
        tier: 'gold',
        balance: 50000,
        points: 100,
        totalSpent: 0,
        visitCount: 0,
        lastVisitAt: null,
        remark: 'VIP',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);
    context.prismaService.marketingCustomer.count.mockResolvedValue(1);
    // groupBy 默认返回 [] —— 不触发覆盖逻辑
    context.prismaService.marketingConsumption.groupBy.mockResolvedValueOnce(
      [],
    );

    const result = await context.service.listCustomers(context.user, {
      page: 1,
      pageSize: 20,
    });

    // 没有消费记录时保持物化字段原值，避免被强制清零
    expect(result.items[0]?.totalSpent).toBe(0);
    expect(result.items[0]?.visitCount).toBe(0);
    expect(result.items[0]?.lastVisitAt).toBeNull();
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
    context.prismaService.marketingConsumption.aggregate
      // 1. computeCustomerFinance: totalPointsDeducted
      .mockResolvedValueOnce({ _sum: { pointsDeducted: 0 } })
      // 2. F9: 实时聚合 totalSpent / visitCount / lastVisitAt（与物化字段一致）
      .mockResolvedValueOnce({
        _sum: { amount: 52000 },
        _count: { _all: 6 },
        _max: { createdAt: new Date('2026-05-14T10:00:00.000Z') },
      });
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
    // refundableAmount = min(累计充值本金(350) - 累计退款(0), 当前余额(200) - 赠送余额(20))
    //                 = min(350, 180) = 180
    expect(result.refundableAmount).toBe(180);
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
      signedAmount: 100,
      signedTotalAmount: 120,
      type: 'recharge',
      promotionId: undefined,
      promotionName: undefined,
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
    // F9: 实时聚合与物化字段一致时透传
    expect(result.totalSpent).toBe(520);
    expect(result.visitCount).toBe(6);
    expect(result.lastVisitAt).toBe(
      new Date('2026-05-14T10:00:00.000Z').getTime(),
    );
  });

  it('getCustomer 在物化字段 visitCount=0 但消费表有 128 笔时以实时聚合为准（F9 修复场景）', async () => {
    // 模拟 Jeffrey 这类历史脏数据：物化字段金额很高，但 visitCount=0
    context.prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 9,
          storeId: 18,
          name: 'Jeffrey',
          phone: '13919654010',
          avatar: null,
          tier: 'gold',
          balance: 0,
          points: 0,
          totalSpent: 22190800, // 物化字段 ¥221,908.00（脏）
          visitCount: 0, // ❌ 次数 0
          lastVisitAt: new Date('2025-01-01T00:00:00.000Z'),
          remark: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]) // recentRecharges: 空
      .mockResolvedValueOnce([]) // recentConsumptions: 空
      .mockResolvedValueOnce([]); // queryCustomerGiftBalanceCents: 空
    context.prismaService.marketingRecharge.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } }) // recharge
      .mockResolvedValueOnce({ _sum: { amount: 0 } }); // refund
    context.prismaService.marketingConsumption.aggregate
      // 1. computeCustomerFinance: totalPointsDeducted
      .mockResolvedValueOnce({ _sum: { pointsDeducted: 0 } })
      // 2. F9: 实时聚合（消费表里有 128 笔 ¥22,190.80 总额，最近消费时间更新）
      .mockResolvedValueOnce({
        _sum: { amount: 2219080 },
        _count: { _all: 128 },
        _max: { createdAt: new Date('2026-05-15T11:30:00.000Z') },
      });
    context.clubMemberProfileService.getSnapshotByStoreAndPhone.mockResolvedValue(
      null,
    );
    context.clubMemberLevelsService.resolveCurrentLevelConfig.mockResolvedValue(
      null,
    );

    const result = await context.service.getCustomer(context.user, 9);

    // 验证：以实时聚合覆盖脏物化字段
    expect(result.totalSpent).toBe(22190.8);
    expect(result.visitCount).toBe(128);
    expect(result.lastVisitAt).toBe(
      new Date('2026-05-15T11:30:00.000Z').getTime(),
    );
    // 状态应根据最新的 lastVisitAt 重新计算（11:30 < 30 天 → active）
    expect(result.status).toBe('active');
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
