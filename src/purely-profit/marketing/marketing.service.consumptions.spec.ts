import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService consumptions', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('createConsumption 在积分抵扣时写入 spend 积分流水', async () => {
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
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
    context.prismaService.$transaction.mockImplementationOnce((callback) =>
      callback(transactionClient),
    );

    const result = await context.service.createConsumption(context.user, 18, {
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
});
