import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import { MarketingConsumptionLinkService } from './marketing-consumption-link.service';

function createTransactionMock() {
  return {
    marketingCustomer: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    marketingConsumption: {
      create: jest.fn(),
    },
  };
}

describe('MarketingConsumptionLinkService', () => {
  let service: MarketingConsumptionLinkService;
  let tx: ReturnType<typeof createTransactionMock>;
  const redisService = {
    delByPattern: jest.fn().mockResolvedValue(undefined),
  };
  const cacheInvalidatorService = {
    invalidateMarketingOverview: jest.fn().mockResolvedValue(undefined),
  };

  const baseParams = {
    storeId: 18,
    guestName: '王五',
    guestPhone: '13900001111',
    totalRevenueYuan: 200,
    paymentMethod: 'cash',
    checkoutAt: new Date('2026-08-02T10:00:00.000Z').getTime(),
    itemsSummary: '包间2小时、矿泉水 × 2',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tx = createTransactionMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConsumptionLinkService,
        { provide: PrismaService, useValue: {} },
        { provide: RedisService, useValue: redisService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();
    service = module.get<MarketingConsumptionLinkService>(
      MarketingConsumptionLinkService,
    );
  });

  it('无手机号时跳过联动（不查询会员、不写消费）', async () => {
    await service.linkSpaceSettlementConsumption(
      tx as never,
      { ...baseParams, guestPhone: '  ' },
    );

    expect(tx.marketingCustomer.findFirst).not.toHaveBeenCalled();
    expect(tx.marketingCustomer.create).not.toHaveBeenCalled();
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
  });

  it('结算金额 <= 0（纯退款/纯抵扣）时跳过联动', async () => {
    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      totalRevenueYuan: 0,
    });
    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      totalRevenueYuan: -10,
    });

    expect(tx.marketingCustomer.findFirst).not.toHaveBeenCalled();
    expect(tx.marketingConsumption.create).not.toHaveBeenCalled();
  });

  it('已有会员时 update 物化字段（全额计入）并写消费流水', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue({
      id: 9,
      totalSpent: 100000, // ¥1000.00
    });

    await service.linkSpaceSettlementConsumption(tx as never, baseParams);

    expect(tx.marketingCustomer.findFirst).toHaveBeenCalledWith({
      where: { storeId: 18, phone: '13900001111', deletedAt: null },
      select: { id: true, totalSpent: true },
    });
    expect(tx.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        totalSpent: { increment: 20000 }, // ¥200.00
        visitCount: { increment: 1 },
        lastVisitAt: new Date(baseParams.checkoutAt),
        tier: 'regular', // 新累计 ¥1200 未到 gold 门槛
      },
    });
    expect(tx.marketingConsumption.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        customerId: 9,
        amount: 20000,
        balancePaid: 0,
        pointsDeducted: 0,
        payType: 'cash',
        itemsSummary: '包间2小时、矿泉水 × 2',
      },
    });
  });

  it('无会员时 create 会员并初始化物化字段与消费流水', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue(null);
    tx.marketingCustomer.create.mockResolvedValue({ id: 99 });

    await service.linkSpaceSettlementConsumption(tx as never, baseParams);

    expect(tx.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '王五',
        phone: '13900001111',
        totalSpent: 20000,
        visitCount: 1,
        lastVisitAt: new Date(baseParams.checkoutAt),
        tier: 'regular',
      },
    });
    expect(tx.marketingConsumption.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        customerId: 99,
        amount: 20000,
        balancePaid: 0,
        pointsDeducted: 0,
        payType: 'cash',
        itemsSummary: '包间2小时、矿泉水 × 2',
      },
    });
  });

  it('无姓名时使用默认昵称「空间顾客」', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue(null);
    tx.marketingCustomer.create.mockResolvedValue({ id: 99 });

    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      guestName: '   ',
    });

    expect(tx.marketingCustomer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '空间顾客',
        }),
      }),
    );
  });

  it('空间支付方式映射到营销支付方式（wechat→wechat，groupon_voucher→cash）', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue({ id: 9, totalSpent: 0 });
    tx.marketingCustomer.update.mockResolvedValue({});

    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      paymentMethod: 'wechat',
    });
    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      paymentMethod: 'groupon_voucher',
    });

    const payTypes = tx.marketingConsumption.create.mock.calls.map(
      (call) => call[0].data.payType,
    );
    expect(payTypes).toEqual(['wechat', 'cash']);
  });

  it('累计消费达到 gold 门槛时等级升级', async () => {
    tx.marketingCustomer.findFirst.mockResolvedValue({
      id: 9,
      totalSpent: 190000, // ¥1900.00，距 gold（¥2000）差 ¥100
    });

    await service.linkSpaceSettlementConsumption(tx as never, {
      ...baseParams,
      totalRevenueYuan: 100,
    });

    expect(tx.marketingCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tier: 'gold' }),
      }),
    );
  });

  it('invalidateMarketingDerived 失效 overview / 列表 / 详情缓存', async () => {
    await service.invalidateMarketingDerived(18);

    expect(
      cacheInvalidatorService.invalidateMarketingOverview,
    ).toHaveBeenCalledWith(18);
    expect(redisService.delByPattern).toHaveBeenCalledWith(
      'profit:marketing:customers:list:store:18:*',
    );
    expect(redisService.delByPattern).toHaveBeenCalledWith(
      'profit:marketing:customer:detail:store:18:*',
    );
  });
});
