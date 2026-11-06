import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { RedisService } from '../../redis/redis.service';
import {
  buildClubPromotionListCacheKey,
  buildClubPromotionsCacheKey,
} from '../../redis/cache-keys';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import { MarketingPromotionsService } from './marketing-promotions.service';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildPromotionDisplayText,
  mapPromotionParamsForOutput,
  mapPromotionParamsForWrite,
  normalizePromotionParams,
} from './marketing.mapper';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  PROMOTION_TYPE_CONFLICT_MESSAGE,
  throwOnPromotionTypeConflict,
} from './marketing.utils';
import {
  DEFAULT_DAILY_CHECK_IN_POINTS,
  validatePromotionParams,
} from './schemas/promotion-params.schema';

const NOW = new Date('2026-11-06T08:00:00.000Z');
const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');

const user: AuthenticatedUser = {
  id: 1,
  email: 'owner@purelyprofit.local',
  phone: '13900139000',
  name: '商家管理员',
  createdAt: NOW,
  updatedAt: NOW,
  lastActiveAt: null,
  accountScope: 'purely_profit',
  currentMembership: null,
};

const createDto = (
  overrides: Partial<CreatePromotionDto> = {},
): CreatePromotionDto =>
  ({
    name: '每日签到',
    type: 'daily_check_in',
    description: '',
    params: { pointsPerCheckIn: 5 },
    startAt: START_AT.getTime(),
    endAt: END_AT.getTime(),
    enabled: true,
    ...overrides,
  }) as CreatePromotionDto;

const promotionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  storeId: 11,
  name: '每日签到',
  type: 'daily_check_in',
  description: '',
  params: { pointsPerCheckIn: 5 },
  displayText: '每日签到 +5 积分',
  startAt: START_AT,
  endAt: END_AT,
  usageCount: 0,
  totalDiscount: 0,
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('每日签到活动 · 商家端配置闭环', () => {
  let service: MarketingPromotionsService;
  let prismaService: {
    marketingPromotion: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let redisService: { del: jest.Mock; delByPattern: jest.Mock };
  let cacheInvalidatorService: { invalidateProfitDashboardHome: jest.Mock };
  let marketingSharedService: {
    ensureMarketingStoreAccess: jest.Mock;
    findPromotionOrThrow: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    prismaService = {
      marketingPromotion: {
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }) => promotionRow({ ...data })),
        update: jest
          .fn()
          .mockImplementation(({ data }) => promotionRow({ ...data })),
      },
    };
    redisService = {
      del: jest.fn().mockResolvedValue(undefined),
      delByPattern: jest.fn().mockResolvedValue(0),
    };
    cacheInvalidatorService = {
      invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
    };
    marketingSharedService = {
      ensureMarketingStoreAccess: jest.fn().mockResolvedValue(undefined),
      findPromotionOrThrow: jest.fn().mockResolvedValue(promotionRow()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingPromotionsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: RefreshableCacheService,
          useValue: { getOrLoadRefreshableJson: jest.fn() },
        },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
        { provide: MarketingSharedService, useValue: marketingSharedService },
      ],
    }).compile();
    service = module.get<MarketingPromotionsService>(
      MarketingPromotionsService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('活动类型白名单与 DTO @IsIn 共用常量，包含 daily_check_in', () => {
    expect(MARKETING_PROMOTION_TYPE_VALUES).toContain('daily_check_in');
    expect(
      validatePromotionParams('daily_check_in', { pointsPerCheckIn: 5 }),
    ).toEqual({ pointsPerCheckIn: 5 });
  });

  it('params 缺失 / 非法回落默认 1，其余字段不允许混入', () => {
    const dirty: unknown[] = [
      undefined,
      {},
      { pointsPerCheckIn: 0 },
      { pointsPerCheckIn: -1 },
      { pointsPerCheckIn: 2.5 },
      { pointsPerCheckIn: '9' },
      { pointsPerCheckIn: Number.MAX_SAFE_INTEGER },
    ];
    for (const params of dirty) {
      expect(validatePromotionParams('daily_check_in', params)).toEqual({
        pointsPerCheckIn: DEFAULT_DAILY_CHECK_IN_POINTS,
      });
    }
    expect(() =>
      validatePromotionParams('daily_check_in', {
        pointsPerCheckIn: 5,
        storeId: 999,
      }),
    ).toThrow(BadRequestException);
  });

  it('积分数量绝不经过元⇄分转换，displayText 为「每日签到 +N 积分」', () => {
    const params = normalizePromotionParams(
      { pointsPerCheckIn: 100 },
      'daily_check_in',
    );
    expect(params).toEqual({ pointsPerCheckIn: 100 });
    expect(mapPromotionParamsForWrite(params, 'daily_check_in')).toEqual({
      pointsPerCheckIn: 100,
    });
    expect(mapPromotionParamsForOutput(params, 'daily_check_in')).toEqual({
      pointsPerCheckIn: 100,
    });
    expect(buildPromotionDisplayText('daily_check_in', params)).toBe(
      '每日签到 +100 积分',
    );
    expect(buildPromotionDisplayText('daily_check_in', {})).toBe(
      '每日签到 +1 积分',
    );
  });

  it('create 停用态也做全量唯一校验，重复时抛统一冲突文案', async () => {
    prismaService.marketingPromotion.count.mockResolvedValue(1);

    await expect(
      service.createPromotion(user, 11, createDto({ enabled: false })),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.createPromotion(user, 11, createDto({ enabled: false })),
    ).rejects.toThrow(PROMOTION_TYPE_CONFLICT_MESSAGE);
    const where = prismaService.marketingPromotion.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toEqual({ storeId: 11, type: 'daily_check_in' });
    expect(where.where).not.toHaveProperty('enabled');
  });

  it('create 落库毫秒时间窗与积分参数，启停后失效 C 端活动缓存', async () => {
    const result = await service.createPromotion(user, 11, createDto());

    expect(result.displayText).toBe('每日签到 +5 积分');
    expect(result.params).toEqual({ pointsPerCheckIn: 5 });
    expect(result.startAt).toBe(START_AT.getTime());
    expect(result.endAt).toBe(END_AT.getTime());
    const createArg = prismaService.marketingPromotion.create.mock
      .calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.params).toEqual({ pointsPerCheckIn: 5 });
    expect(createArg.data.startAt).toEqual(START_AT);
    expect(createArg.data).not.toHaveProperty('totalDiscount');
    expect(redisService.del).toHaveBeenCalledWith(
      buildClubPromotionsCacheKey(11),
    );
    expect(redisService.del).toHaveBeenCalledWith(
      buildClubPromotionListCacheKey(11),
    );
  });

  it('create 并发 P2002 转 ConflictException 且文案一致', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });
    prismaService.marketingPromotion.create.mockRejectedValue(p2002);

    await expect(
      service.createPromotion(user, 11, createDto()),
    ).rejects.toThrow(PROMOTION_TYPE_CONFLICT_MESSAGE);
    expect(() => throwOnPromotionTypeConflict(p2002)).toThrow(
      PROMOTION_TYPE_CONFLICT_MESSAGE,
    );
  });

  it('update 停用态签到活动仍走全量唯一校验并复用缓存失效', async () => {
    marketingSharedService.findPromotionOrThrow.mockResolvedValue(
      promotionRow({ enabled: false }),
    );
    prismaService.marketingPromotion.count.mockResolvedValue(1);

    const dto = { params: { pointsPerCheckIn: 8 } } as UpdatePromotionDto;
    await expect(service.updatePromotion(user, 7, dto)).rejects.toThrow(
      ConflictException,
    );
    const where = prismaService.marketingPromotion.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toEqual({
      storeId: 11,
      type: 'daily_check_in',
      id: { not: 7 },
    });

    prismaService.marketingPromotion.count.mockResolvedValue(0);
    await service.updatePromotion(user, 7, dto);
    expect(redisService.del).toHaveBeenCalledWith(
      buildClubPromotionListCacheKey(11),
    );
  });
});
