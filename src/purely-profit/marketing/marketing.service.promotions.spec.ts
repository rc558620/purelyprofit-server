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

  it('listPromotions 返回 status 衍生字段', async () => {
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
    });
  });
});
