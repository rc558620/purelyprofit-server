import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService points records', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listPointsRecords 返回前端积分流水契约', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValueOnce(18);
    context.prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 301,
        storeId: 18,
        customerId: 9,
        amount: -500,
        type: 'spend',
        description: '消费抵扣：商务套餐 × 2',
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
        _total: 1,
      },
    ]);

    const result = await context.service.listPointsRecords(context.user, {
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
          id: 302,
          storeId: 18,
          customerId: 9,
          amount: 200,
          type: 'gift',
          description: '活动赠送积分',
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
          _total: 1,
        },
      ]);

    const result = await context.service.listCustomerPointsRecords(
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
    expect(result.items[0]).toEqual({
      id: '302',
      customerId: '9',
      amount: 200,
      type: 'gift',
      description: '活动赠送积分',
      createdAt: new Date('2026-05-13T10:00:00.000Z').getTime(),
    });
  });
});
