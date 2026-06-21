import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseGrowthAccessService } from './growth-access.service';
import {
  buildPulseGrowthEarningsLogsCacheKey,
  buildPulseGrowthEarningsOverviewCacheKey,
} from '../pulse.cache-keys';
import { PulseGrowthEarningsService } from './growth-earnings.service';
import * as growthEarningsDomain from './growth-earnings.domain';
import * as growthEarningsQuery from './growth-earnings.query';

describe('PulseGrowthEarningsService', () => {
  let service: PulseGrowthEarningsService;

  const prismaService = {};
  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
  const accessService = {
    resolveTargetStoreForGrowth: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseGrowthEarningsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: PulseGrowthAccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get<PulseGrowthEarningsService>(
      PulseGrowthEarningsService,
    );
  });

  it('getEarningsOverview 命中缓存时直接返回', async () => {
    const cached = {
      beanBalance: 100,
      totalEarnedBeans: 100,
      totalWithdrawnBeans: 0,
      totalPromos: 2,
      chargedPromos: 1,
      isPartner: true,
      pendingWithdrawals: 0,
      approvedPartner: null,
      approvedPartners: [],
    };
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({ id: 18 });
    redisService.getJson.mockResolvedValue(cached);
    const querySpy = jest.spyOn(
      growthEarningsQuery,
      'queryEarningsOverviewData',
    );

    await expect(service.getEarningsOverview(user)).resolves.toEqual(cached);
    expect(redisService.getJson).toHaveBeenCalledWith(
      buildPulseGrowthEarningsOverviewCacheKey(18),
    );
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('getEarningsOverview 未命中缓存时会查询并回填缓存', async () => {
    const overviewData = {
      partners: [],
      promoRecords: [],
      pendingWithdrawals: 1,
    };
    const mapped = {
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      totalPromos: 0,
      chargedPromos: 0,
      isPartner: false,
      pendingWithdrawals: 1,
      approvedPartner: null,
      approvedPartners: [],
    };
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({ id: 18 });
    redisService.getJson.mockResolvedValue(null);
    jest
      .spyOn(growthEarningsQuery, 'queryEarningsOverviewData')
      .mockResolvedValue(overviewData as never);
    jest
      .spyOn(growthEarningsDomain, 'buildEarningsOverviewResponse')
      .mockReturnValue(mapped as never);

    await expect(service.getEarningsOverview(user)).resolves.toEqual(mapped);
    expect(redisService.setJson).toHaveBeenCalledWith(
      buildPulseGrowthEarningsOverviewCacheKey(18),
      mapped,
      20,
    );
  });

  it('getEarningsLogs 命中缓存时直接返回', async () => {
    const cached = {
      approvedPartner: null,
      approvedPartners: [],
      items: [],
      beanBalance: 20,
      hasMore: false,
      nextCursor: null,
    };
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      ownerName: '张三',
    });
    redisService.getJson.mockResolvedValue(cached);
    const overviewSpy = jest.spyOn(
      growthEarningsQuery,
      'queryEarningsOverviewData',
    );
    const logsSpy = jest.spyOn(growthEarningsQuery, 'queryPartnerBeanLogs');

    await expect(
      service.getEarningsLogs(user, { type: 'earn' }),
    ).resolves.toEqual(cached);
    expect(redisService.getJson).toHaveBeenCalledWith(
      buildPulseGrowthEarningsLogsCacheKey(18, 'earn'),
    );
    expect(overviewSpy).not.toHaveBeenCalled();
    expect(logsSpy).not.toHaveBeenCalled();
  });

  it('getEarningsLogs 未命中缓存时会查询并回填缓存', async () => {
    const overviewData = {
      partners: [],
      promoRecords: [],
      pendingWithdrawals: 0,
    };
    const logs = [];
    const mapped = {
      approvedPartner: null,
      approvedPartners: [],
      items: [],
      beanBalance: 0,
      hasMore: false,
      nextCursor: null,
    };
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      ownerName: '张三',
    });
    redisService.getJson.mockResolvedValue(null);
    jest
      .spyOn(growthEarningsQuery, 'queryEarningsOverviewData')
      .mockResolvedValue(overviewData as never);
    jest
      .spyOn(growthEarningsQuery, 'queryPartnerBeanLogs')
      .mockResolvedValue(logs as never);
    jest
      .spyOn(growthEarningsDomain, 'buildEarningsLogsResponse')
      .mockReturnValue(mapped as never);

    await expect(
      service.getEarningsLogs(user, { type: 'withdraw' }),
    ).resolves.toEqual(mapped);
    expect(redisService.setJson).toHaveBeenCalledWith(
      buildPulseGrowthEarningsLogsCacheKey(18, 'withdraw'),
      mapped,
      20,
    );
  });

  it('getEarningsLogs cursor 模式下跳过缓存并按游标查询下一页', async () => {
    const overviewData = {
      partners: [],
      promoRecords: [],
      pendingWithdrawals: 0,
    };
    const logs = [];
    const mapped = {
      approvedPartner: null,
      approvedPartners: [],
      items: [],
      beanBalance: 0,
      hasMore: false,
      nextCursor: null,
    };
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      ownerName: '张三',
    });
    jest
      .spyOn(growthEarningsQuery, 'queryEarningsOverviewData')
      .mockResolvedValue(overviewData as never);
    const logsSpy = jest
      .spyOn(growthEarningsQuery, 'queryPartnerBeanLogs')
      .mockResolvedValue(logs as never);
    const domainSpy = jest
      .spyOn(growthEarningsDomain, 'buildEarningsLogsResponse')
      .mockReturnValue(mapped as never);

    await expect(
      service.getEarningsLogs(user, {
        type: 'spend',
        cursor: '1747123200000_128',
        limit: 30,
      }),
    ).resolves.toEqual(mapped);

    expect(redisService.getJson).not.toHaveBeenCalled();
    expect(redisService.setJson).not.toHaveBeenCalled();
    expect(logsSpy).toHaveBeenCalledWith(prismaService, {
      storeId: 18,
      typeFilter: 'spend',
      cursor: {
        createdAt: new Date('2025-05-13T08:00:00.000Z'),
        id: 128,
      },
      limit: 30,
    });
    expect(domainSpy).toHaveBeenCalledWith({
      partners: overviewData.partners,
      logs,
      ownerName: '张三',
      limit: 30,
    });
  });

  it('getEarningsLogs cursor 非法时抛 BadRequestException', async () => {
    accessService.resolveTargetStoreForGrowth.mockResolvedValue({
      id: 18,
      ownerName: '张三',
    });

    await expect(
      service.getEarningsLogs(user, {
        cursor: 'bad-cursor',
      }),
    ).rejects.toThrow('cursor 格式不合法');
  });

  it('buildEarningsLogsResponse 在 cursor 模式下返回 nextCursor', () => {
    const result = growthEarningsDomain.buildEarningsLogsResponse({
      partners: [
        {
          id: 7,
          status: 'approved',
          name: '张三',
          phone: '13800138000',
          beanBalance: 32,
          totalEarnedBeans: 120,
          totalWithdrawnBeans: 88,
          joinedAt: new Date('2026-05-01T00:00:00.000Z'),
          paymentAccountType: 'alipay',
          paymentAccountNo: '13800138000',
          paymentAccountName: '张三',
        },
      ],
      logs: [
        {
          id: 18,
          source: 'promo_reward',
          changeAmount: 10,
          description: '奖励 10 豆',
          relatedPromoRecordId: null,
          relatedUser: '李四',
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
        },
        {
          id: 17,
          source: 'deduct_payment',
          changeAmount: -3,
          description: '抵扣 3 豆',
          relatedPromoRecordId: null,
          relatedUser: null,
          createdAt: new Date('2026-05-15T09:00:00.000Z'),
        },
      ],
      ownerName: '张三',
      limit: 1,
    });

    expect(result).toEqual({
      approvedPartner: {
        id: '7',
        name: '张三',
        phone: '13800138000',
        joinedAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
        beanBalance: 32,
        totalEarnedBeans: 120,
        totalWithdrawnBeans: 88,
      },
      approvedPartners: [
        {
          id: '7',
          name: '张三',
          phone: '13800138000',
          joinedAt: new Date('2026-05-01T00:00:00.000Z').getTime(),
          beanBalance: 32,
          totalEarnedBeans: 120,
          totalWithdrawnBeans: 88,
        },
      ],
      items: [
        {
          id: 'bean-18',
          userId: 'store-owner',
          userName: '张三',
          userPhone: '',
          amount: 10,
          type: 'earn',
          source: 'promo_reward',
          description: '奖励 10 豆',
          relatedPromoId: undefined,
          relatedUser: '李四',
          createdAt: new Date('2026-05-15T10:00:00.000Z').getTime(),
        },
      ],
      beanBalance: 32,
      hasMore: true,
      nextCursor: `${new Date('2026-05-15T10:00:00.000Z').getTime()}_18`,
    });
  });
});
