import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService promotions', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listPromotions 返回 status 衍生字段并兼容旧版单档充赠参数', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.prismaService.marketingPromotion.findMany.mockResolvedValue([
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
    context.prismaService.marketingPromotion.count.mockResolvedValue(1);

    const result = await context.service.listPromotions(context.user, {
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: '3',
      status: 'active',
      enabled: true,
      params: {
        gradients: [{ rechargeAmount: 100, giftRatio: 0.2 }],
      },
    });
  });

  it('listPromotions 保留多档储值赠送参数结构', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 4,
        storeId: 18,
        name: '充值多送',
        type: 'recharge_gift',
        description: '多档赠送',
        params: {
          gradients: [
            { rechargeAmount: 10000, giftAmount: 1000 },
            { rechargeAmount: 30000, giftAmount: 5000 },
          ],
        },
        startAt: new Date('2026-05-01T00:00:00.000Z'),
        endAt: new Date('2026-05-31T23:59:59.000Z'),
        usageCount: 0,
        totalDiscount: 0,
        enabled: true,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);
    context.prismaService.marketingPromotion.count.mockResolvedValue(1);

    const result = await context.service.listPromotions(context.user, {
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0].params).toEqual({
      gradients: [
        { rechargeAmount: 100, giftAmount: 10 },
        { rechargeAmount: 300, giftAmount: 50 },
      ],
    });
  });

  it('createPromotion 支持首单优惠类型', async () => {
    context.accessService.ensureCanAccess.mockResolvedValue(undefined);
    context.prismaService.marketingPromotion.count.mockResolvedValue(0);
    context.prismaService.marketingPromotion.create.mockResolvedValue({
      id: 8,
      storeId: 18,
      name: '首单 8 折',
      type: 'first_order_discount',
      description: '新顾客首单专享',
      params: { discountRate: 80, audience: 'first_order' },
      startAt: new Date('2026-05-01T00:00:00.000Z'),
      endAt: new Date('2026-05-31T23:59:59.000Z'),
      usageCount: 0,
      totalDiscount: 0,
      enabled: true,
      createdAt: new Date('2026-04-25T00:00:00.000Z'),
      updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    });

    const result = await context.service.createPromotion(context.user, 18, {
      name: '首单 8 折',
      type: 'first_order_discount',
      description: '新顾客首单专享',
      params: { discountRate: 80, audience: 'first_order' },
      startAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
      endAt: new Date('2026-05-31T23:59:59.000Z').getTime(),
      enabled: true,
    });

    expect(
      context.prismaService.marketingPromotion.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 18,
        type: 'first_order_discount',
        params: { discountRate: 80, audience: 'first_order' },
      }),
    });
    expect(result.type).toBe('first_order_discount');
  });

  it('createPromotion 不允许同门店重复创建相同活动类型', async () => {
    context.accessService.ensureCanAccess.mockResolvedValue(undefined);
    context.prismaService.marketingPromotion.count.mockResolvedValue(1);

    await expect(
      context.service.createPromotion(context.user, 18, {
        name: '新人 8 折',
        type: 'first_order_discount',
        description: '首单专享',
        params: { discountRate: 80, audience: 'first_order' },
        startAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
        endAt: new Date('2026-05-31T23:59:59.000Z').getTime(),
        enabled: true,
      }),
    ).rejects.toThrow('当前门店已存在相同类型的上架活动，请直接编辑现有活动');
    expect(
      context.prismaService.marketingPromotion.create,
    ).not.toHaveBeenCalled();
  });

  it('updatePromotion 不允许编辑到重复活动类型记录', async () => {
    context.prismaService.$queryRaw.mockResolvedValue([
      {
        id: 9,
        storeId: 18,
        name: '首单 85 折',
        type: 'first_order_discount',
        description: '首单专享',
        params: { discountRate: 85, audience: 'first_order' },
        startAt: new Date('2026-05-01T00:00:00.000Z'),
        endAt: new Date('2026-05-31T23:59:59.000Z'),
        usageCount: 0,
        totalDiscount: 0,
        enabled: true,
        createdAt: new Date('2026-04-25T00:00:00.000Z'),
        updatedAt: new Date('2026-04-25T00:00:00.000Z'),
      },
    ]);
    context.accessService.ensureCanAccess.mockResolvedValue(undefined);
    context.prismaService.marketingPromotion.count.mockResolvedValue(1);

    await expect(
      context.service.updatePromotion(context.user, 9, {
        name: '首单 8 折',
      }),
    ).rejects.toThrow('当前门店已存在相同类型的上架活动，请直接编辑现有活动');
    expect(
      context.prismaService.marketingPromotion.update,
    ).not.toHaveBeenCalled();
  });

  it('getMemberLevelSettings 在未配置时返回默认等级和积分规则', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(
      null,
    );
    context.prismaService.marketingPromotion.findFirst.mockResolvedValue(null);

    const result = await context.service.getMemberLevelSettings(context.user);

    expect(result.levels).toEqual([
      expect.objectContaining({
        id: 'gold',
        spendThreshold: 0,
        discountRatePct: 90,
      }),
      expect.objectContaining({ id: 'platinum', spendThreshold: 5000 }),
      expect.objectContaining({ id: 'diamond', spendThreshold: 10000 }),
    ]);
    expect(result.pointsRatio).toEqual(
      expect.objectContaining({
        earnRatioYuan: 100,
        redeemRatioPoints: 1,
        maxRedeemPct: 50,
        enabled: false,
      }),
    );
    expect(result.pointsFeatureEnabled).toBe(false);
  });

  it('getMemberLevelSettings 在存在有效充值赠积分活动时返回 pointsFeatureEnabled=true', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(
      null,
    );
    context.prismaService.marketingPromotion.findFirst.mockResolvedValue({
      params: { rechargeRatioPercent: 2 },
    });

    const result = await context.service.getMemberLevelSettings(context.user);

    expect(
      context.prismaService.marketingPromotion.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          type: 'points_recharge',
          enabled: true,
        }),
      }),
    );
    expect(result.pointsFeatureEnabled).toBe(true);
  });

  it('updateMemberLevel 会合并默认配置并按门店 upsert', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.accessService.ensureCanAccess.mockResolvedValue(undefined);
    context.prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(
      {
        levels: [
          {
            id: 'gold',
            name: '黄金会员',
            discountRate: 0.95,
            discountRatePct: 95,
            spendThreshold: 3000,
            description: '历史配置',
            enabled: true,
            updatedAt: 1,
          },
        ],
        pointsRatio: {
          earnRatioCents: 200,
          earnRatioYuan: 200,
          redeemRatioPoints: 100,
          maxRedeemRatio: 0.3,
          maxRedeemPct: 30,
          enabled: true,
          updatedAt: 2,
        },
      },
    );
    context.prismaService.marketingMemberLevelSetting.upsert.mockResolvedValue(
      undefined,
    );

    const result = await context.service.updateMemberLevel(
      context.user,
      'gold',
      {
        discountRatePct: 88,
        spendThreshold: 999999,
        description: '充值即享 88 折',
        enabled: false,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'gold',
        discountRatePct: 88,
        spendThreshold: 0,
        description: '充值即享 88 折',
        enabled: false,
      }),
    );
    expect(
      context.prismaService.marketingMemberLevelSetting.upsert,
    ).toHaveBeenCalledWith({
      where: { storeId: 18 },
      create: expect.objectContaining({
        storeId: 18,
        levels: expect.arrayContaining([
          expect.objectContaining({ id: 'gold', spendThreshold: 0, discountRate: 0.88, discountRatePct: 88 }),
          expect.objectContaining({ id: 'platinum', spendThreshold: 5000 }),
          expect.objectContaining({ id: 'diamond', spendThreshold: 10000 }),
        ]),
        pointsRatio: expect.objectContaining({ earnRatioCents: 200, earnRatioYuan: 200 }),
      }),
      update: expect.objectContaining({
        levels: expect.arrayContaining([
          expect.objectContaining({ id: 'gold', spendThreshold: 0, discountRate: 0.88, discountRatePct: 88 }),
        ]),
      }),
    });
  });

  it('updatePointsRatio 会更新积分规则并保留等级配置', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.accessService.ensureCanAccess.mockResolvedValue(undefined);
    context.prismaService.marketingMemberLevelSetting.findUnique.mockResolvedValue(
      null,
    );
    context.prismaService.marketingMemberLevelSetting.upsert.mockResolvedValue(
      undefined,
    );

    const result = await context.service.updatePointsRatio(context.user, {
      earnRatioYuan: 300,
      redeemRatioPoints: 200,
      maxRedeemPct: 40,
      enabled: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        earnRatioYuan: 300,
        redeemRatioPoints: 200,
        maxRedeemPct: 40,
        enabled: false,
      }),
    );
    expect(
      context.prismaService.marketingMemberLevelSetting.upsert,
    ).toHaveBeenCalledWith({
      where: { storeId: 18 },
      create: expect.objectContaining({
        storeId: 18,
        levels: expect.arrayContaining([
          expect.objectContaining({ id: 'gold' }),
          expect.objectContaining({ id: 'platinum' }),
          expect.objectContaining({ id: 'diamond' }),
        ]),
        pointsRatio: expect.objectContaining({
          earnRatioCents: 300,
          earnRatioYuan: 300,
          redeemRatioPoints: 200,
          maxRedeemRatio: 0.4,
          maxRedeemPct: 40,
          enabled: false,
        }),
      }),
      update: expect.objectContaining({
        pointsRatio: expect.objectContaining({
          earnRatioCents: 300,
          earnRatioYuan: 300,
          redeemRatioPoints: 200,
          maxRedeemRatio: 0.4,
          maxRedeemPct: 40,
          enabled: false,
        }),
      }),
    });
  });
});
