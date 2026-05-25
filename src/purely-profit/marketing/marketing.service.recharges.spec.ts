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
});
