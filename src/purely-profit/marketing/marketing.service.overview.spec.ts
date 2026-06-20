import { ForbiddenException } from '@nestjs/common';
import {
  createMarketingServiceTestingContext,
  type MarketingServiceTestingContext,
} from './marketing.service.test-setup';

describe('MarketingService overview', () => {
  let context: MarketingServiceTestingContext;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    context = await createMarketingServiceTestingContext();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getOverview 在会员不支持营销中心时拒绝访问', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockRejectedValue(
      new ForbiddenException('当前会员套餐暂不支持营销中心，请升级会员后使用'),
    );

    await expect(
      context.service.getOverview(context.user, 18),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      context.prismaService.marketingCustomer.count,
    ).not.toHaveBeenCalled();
  });

  it('getOverview 按前端首页契约返回纯储值概览和年度趋势', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    context.prismaService.marketingCustomer.count.mockResolvedValueOnce(6);
    context.prismaService.marketingCustomer.aggregate.mockResolvedValue({
      _sum: { balance: 88000 },
    });
    context.prismaService.marketingRecharge.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100000, giftAmount: 10000 } })
      .mockResolvedValueOnce({ _sum: { amount: 20000, giftAmount: 3000 } })
      .mockResolvedValueOnce({ _sum: { amount: 50000, giftAmount: 5000 } });
    context.prismaService.marketingRecharge.count.mockResolvedValue(7);
    context.prismaService.$queryRaw
      .mockResolvedValueOnce([
        { date: new Date('2026-05-14T00:00:00.000Z'), total: 12000 },
        { date: new Date('2026-05-15T00:00:00.000Z'), total: 8000 },
      ])
      .mockResolvedValueOnce([
        { year: 2025, month: 3, total: 25000 },
        { year: 2026, month: 2, total: 15000 },
        { year: 2026, month: 5, total: 20000 },
      ]);
    context.prismaService.marketingRecharge.findMany.mockResolvedValue([
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
    context.prismaService.store.findUnique.mockResolvedValue({
      wechatMchId: null,
      wechatMchName: null,
      wechatApiV3Key: null,
      wechatConfiguredAt: null,
    });

    const result = await context.service.getOverview(context.user, 18);

    expect(result).toEqual({
      totalBalance: 88000,
      totalRecharge: 110000,
      todayRecharge: 23000,
      thisMonthRecharge: 55000,
      rechargeCount: 7,
      activeMemberCount: 6,
      inviteCode: buildExpectedInviteCode(18),
      inviteCodeQrCodeImageUrl: buildExpectedInviteQrCodeImageUrl(18),
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
      wechatPayConfig: {
        configured: false,
      },
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

  it('getOverview 在门店微信收款字段未迁移时降级返回未配置状态', async () => {
    context.accessService.resolveViewStoreId.mockResolvedValue(18);
    context.platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    context.prismaService.marketingCustomer.count.mockResolvedValueOnce(0);
    context.prismaService.marketingCustomer.aggregate.mockResolvedValue({
      _sum: { balance: 0 },
    });
    context.prismaService.marketingRecharge.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0, giftAmount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0, giftAmount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0, giftAmount: 0 } });
    context.prismaService.marketingRecharge.count.mockResolvedValue(0);
    context.prismaService.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    context.prismaService.marketingRecharge.findMany.mockResolvedValue([]);
    context.prismaService.store.findUnique.mockRejectedValueOnce(
      new Error('column stores.wechat_mch_id does not exist'),
    );

    const result = await context.service.getOverview(context.user, 18);

    expect(result.wechatPayConfig).toEqual({ configured: false });
  });
});

function buildExpectedInviteCode(storeId: number): string {
  const alphabet = '0123456789';
  let seed = storeId * 1103515245 + 12345;
  let inviteCode = '';

  for (let index = 0; index < 6; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    inviteCode += alphabet[seed % alphabet.length];
  }

  return inviteCode;
}

function buildExpectedInviteQrCodeImageUrl(storeId: number): string {
  const inviteCode = buildExpectedInviteCode(storeId);
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&format=png&margin=0&data=${inviteCode}`;
}
