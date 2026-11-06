import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import { ClubPromotionsService } from './club-promotions.service';

const NOW = new Date('2026-11-06T08:00:00.000Z');
const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');

const user: AuthenticatedUser = {
  id: 201,
  email: 'club_phone_13800138000@purelyprofit.local',
  phone: '13800138000',
  name: '会员用户',
  createdAt: NOW,
  updatedAt: NOW,
  lastActiveAt: null,
  accountScope: 'purely_club',
  currentMembership: null,
};

const context: ClubCurrentContext = {
  user,
  store: {
    id: 11,
    name: '望京旗舰店',
    address: '',
    businessMode: 'general' as const,
    memberCareEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
};

const promotionRow = (
  id: number,
  type: string,
  params: Record<string, unknown> = {},
) => ({
  id,
  name: type === 'daily_check_in' ? '每日签到' : '首单优惠',
  type,
  description: '',
  params,
  startAt: START_AT,
  endAt: END_AT,
  createdAt: NOW,
});

describe('C 端优惠活动卡 · 签到活动排除', () => {
  let service: ClubPromotionsService;
  let prismaService: { marketingPromotion: { findMany: jest.Mock } };
  let redisService: { getJson: jest.Mock; setJson: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    prismaService = {
      marketingPromotion: { findMany: jest.fn().mockResolvedValue([]) },
    };
    redisService = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPromotionsService,
        ClubPromotionRepository,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    service = module.get<ClubPromotionsService>(ClubPromotionsService);
  });

  afterEach(() => jest.useRealTimers());

  it('daily_check_in 不进入优惠活动卡，但查询白名单仍是全量类型', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      promotionRow(1, 'daily_check_in', { pointsPerCheckIn: 3 }),
      promotionRow(2, 'first_order_discount', { discountRate: 80 }),
    ]);

    const result = await service.list(context);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe('first_order_discount');
    const where = prismaService.marketingPromotion.findMany.mock
      .calls[0][0] as { where: { type: { in: string[] } } };
    expect(where.where.type.in).toContain('daily_check_in');
    expect(where.where.type.in).toContain('discount');
  });

  it('定价活动白名单不含签到，签到活动不会被误算进商品折扣', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPromotionRepository,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    const repository = module.get<ClubPromotionRepository>(
      ClubPromotionRepository,
    );
    await repository.loadActivePromotions(11);

    const where = prismaService.marketingPromotion.findMany.mock
      .calls[0][0] as { where: { type: { in: string[] } } };
    expect(where.where.type.in).not.toContain('daily_check_in');
    expect(where.where.type.in).toEqual([
      'first_order_discount',
      'discount',
      'discount_day',
      'reduce',
    ]);
  });
});
