import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisReadPrefetchService } from '../../redis/redis-read-prefetch.service';
import { RedisService } from '../../redis/redis.service';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionTypeValue,
} from '../../purely-profit/marketing/marketing.utils';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubPromotionsService } from './club-promotions.service';

describe('ClubPromotionsService', () => {
  let service: ClubPromotionsService;

  const prismaService = {
    marketingPromotion: {
      findMany: jest.fn(),
    },
  };

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
  /** 本文件不覆盖预取语义：peekJson 恒为 undefined，等价于「未预取」 */
  const redisReadPrefetch = {
    peekJson: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const currentContext: ClubCurrentContext = {
    user,
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      businessMode: 'general' as const,
      memberCareEnabled: false,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPromotionsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: RedisReadPrefetchService, useValue: redisReadPrefetch },
      ],
    }).compile();

    service = module.get<ClubPromotionsService>(ClubPromotionsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('list 返回首页活动卡片所需的扩展字段并按优先级排序', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({
        id: 8,
        name: '首单 8 折',
        type: 'first_order_discount',
        description: '',
        params: {
          discountRate: 80,
          audience: 'first_order',
          bannerImage: 'https://cdn.example.com/club/first-order.png',
        },
      }),
      createPromotion({
        id: 7,
        name: '满减活动',
        type: 'reduce',
        description: '',
        params: { threshold: 10000, reduceAmount: 2000 },
      }),
      createPromotion({
        id: 6,
        name: '充值多送',
        type: 'recharge_gift',
        description: '',
        params: {
          gradients: [
            { rechargeAmount: 10000, giftAmount: 1000 },
            { rechargeAmount: 30000, giftAmount: 5000 },
          ],
          banner: {
            image: 'https://cdn.example.com/club/recharge.png',
          },
        },
      }),
      createPromotion({
        id: 5,
        name: '会员日折扣',
        type: 'discount',
        description: '全场项目 9 折',
        params: { discountRate: 90 },
        endAt: new Date('2026-06-13T08:00:00.000Z'),
      }),
      createPromotion({
        id: 4,
        name: '',
        type: 'free',
        description: '',
        params: {},
      }),
      createPromotion({
        id: 3,
        name: '',
        type: 'points_2x',
        description: '',
        params: {},
      }),
    ]);

    await expect(service.list(currentContext)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: '8',
          type: 'first_order_discount',
          benefitText: '首单 8 折',
          statusText: '进行中',
          timeRangeText: '06.01-07.01',
          priority: 100,
          sort: 10,
          bannerImage: 'https://cdn.example.com/club/first-order.png',
          actionText: '去下单',
          actionType: 'view_products',
          actionTarget: 'club_products',
          params: {
            discountRate: 80,
            audience: 'first_order',
          },
        }),
        expect.objectContaining({
          id: '6',
          type: 'recharge_gift',
          benefitText: '充值多送',
          statusText: '进行中',
          timeRangeText: '06.01-07.01',
          priority: 90,
          sort: 20,
          bannerImage: 'https://cdn.example.com/club/recharge.png',
          actionText: '去充值',
          actionType: 'open_recharge',
          actionTarget: 'club_recharge_packages',
          params: {
            gradients: [
              { rechargeAmount: 100, giftAmount: 10 },
              { rechargeAmount: 300, giftAmount: 50 },
            ],
          },
        }),
        expect.objectContaining({
          id: '7',
          type: 'reduce',
          benefitText: '满减活动',
          statusText: '进行中',
          timeRangeText: '06.01-07.01',
          priority: 80,
          sort: 30,
          actionText: '去使用',
          actionType: 'view_products',
          actionTarget: 'club_products',
          params: { threshold: 100, reduceAmount: 20 },
        }),
        expect.objectContaining({
          id: '5',
          type: 'discount',
          benefitText: '全场项目 9 折',
          statusText: '即将结束',
          timeRangeText: '06.01-06.13',
          priority: 70,
          sort: 40,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
          params: { discountRate: 90 },
        }),
        expect.objectContaining({
          id: '4',
          type: 'free',
          name: '免费体验',
          benefitText: '免费体验',
          priority: 60,
          sort: 50,
          actionText: '了解详情',
          actionType: 'view_products',
          actionTarget: 'club_products',
          params: {},
        }),
        expect.objectContaining({
          id: '3',
          type: 'points_2x',
          name: '双倍积分',
          benefitText: '双倍积分',
          priority: 50,
          sort: 60,
          actionText: '去消费',
          actionType: 'view_products',
          actionTarget: 'club_products',
          params: {},
        }),
      ],
    });

    // 只按 endAt 过滤：未开始的活动也要取回来算「开始」边界；DB 不再 take，
    // 展示上限在排序之后截断（否则截掉的是「最优」而不是「最近创建」）
    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        enabled: true,
        type: { in: [...MARKETING_PROMOTION_TYPE_VALUES] },
        endAt: { gte: new Date('2026-06-12T12:00:00.000Z') },
      },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        params: true,
        startAt: true,
        endAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('命中缓存时不再回源，且缓存里的日期字符串被还原为 Date', async () => {
    redisService.getJson.mockResolvedValue([
      {
        id: 9,
        name: '缓存活动',
        type: 'discount',
        description: '全场 8 折',
        params: { discountRate: 80 },
        startAt: '2026-06-01T00:00:00.000Z',
        endAt: '2026-06-30T23:59:59.000Z',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    ]);

    const result = await service.list(currentContext);

    expect(prismaService.marketingPromotion.findMany).not.toHaveBeenCalled();
    expect(redisService.setJson).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({
        id: '9',
        name: '缓存活动',
        startAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
        endAt: new Date('2026-06-30T23:59:59.000Z').getTime(),
      }),
    ]);
  });

  it('无活动时缓存空数组，后续请求命中缓存不再回源', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);

    await expect(service.list(currentContext)).resolves.toEqual({ items: [] });
    expect(redisService.setJson).toHaveBeenCalledWith(
      expect.stringContaining('club:promotions:store:11'),
      [],
      60,
    );

    // 模拟缓存已写入：后续请求直接命中空数组
    redisService.getJson.mockResolvedValue([]);
    await service.list(currentContext);
    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledTimes(1);
  });

  it('TTL 被最近的结束边界截断（到点即失效，不会把已结束活动再发一轮）', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({ id: 1, endAt: new Date('2026-06-12T12:00:10.000Z') }),
      createPromotion({ id: 2, endAt: new Date('2026-06-12T13:00:00.000Z') }),
    ]);

    await service.list(currentContext);

    expect(redisService.setJson).toHaveBeenCalledWith(
      expect.stringContaining('club:promotions:store:11:list'),
      expect.any(Array),
      10,
    );
  });

  it('未开始的活动不进结果，但它的开始时间决定 TTL（到点即出现）', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      createPromotion({
        id: 1,
        startAt: new Date('2026-06-12T12:00:05.000Z'),
        endAt: new Date('2026-06-12T18:00:00.000Z'),
      }),
    ]);

    await expect(service.list(currentContext)).resolves.toEqual({ items: [] });

    expect(redisService.setJson).toHaveBeenCalledWith(
      expect.stringContaining('club:promotions:store:11:list'),
      [],
      5,
    );
  });

  it('展示上限在排序后截断：高优先级的老活动不会被 DB 截掉', async () => {
    // 21 条：最高优先级的首单活动 createdAt 最老（排在 DB 结果最后），
    // 20 条低优先级折扣活动 createdAt 较新（占满若在 DB 侧 take 20 的名额）
    const rows = [
      ...Array.from({ length: 20 }, (_, index) =>
        createPromotion({
          id: 100 + index,
          type: 'discount',
          createdAt: new Date('2026-06-10T00:00:00.000Z'),
        }),
      ),
      createPromotion({
        id: 1,
        type: 'first_order_discount',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ];
    prismaService.marketingPromotion.findMany.mockResolvedValue(rows);

    const result = await service.list(currentContext);

    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ id: '1', type: 'first_order_discount' }),
    );
  });
});

function createPromotion(
  overrides: Partial<{
    id: number;
    name: string;
    type: MarketingPromotionTypeValue;
    description: string;
    params: Record<string, unknown>;
    startAt: Date;
    endAt: Date;
    createdAt: Date;
  }> = {},
): {
  id: number;
  name: string;
  type: MarketingPromotionTypeValue;
  description: string;
  params: Record<string, unknown>;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
} {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? '限时优惠',
    type: overrides.type ?? 'discount',
    description: overrides.description ?? '',
    params: overrides.params ?? { discountRate: 90 },
    startAt: overrides.startAt ?? new Date('2026-06-01T00:00:00.000Z'),
    endAt: overrides.endAt ?? new Date('2026-06-30T23:59:59.000Z'),
    createdAt: overrides.createdAt ?? new Date('2026-05-20T00:00:00.000Z'),
  };
}
