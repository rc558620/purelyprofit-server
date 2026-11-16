import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubPromotionsCacheKey } from '../../redis/keys/club-cache-keys';
import { ClubPromotionRepository } from './club-promotion.repository';

const NOW = new Date('2026-06-12T12:00:00.000Z');
const CACHE_KEY = buildClubPromotionsCacheKey(11);

const row = (overrides: {
  id: number;
  type?: string;
  startAt?: Date;
  endAt?: Date;
}): {
  id: number;
  name: string;
  type: string;
  params: Record<string, unknown>;
  startAt: Date;
  endAt: Date;
} => ({
  id: overrides.id,
  name: `活动${overrides.id}`,
  type: overrides.type ?? 'discount',
  params: { discountRate: 90 },
  startAt: overrides.startAt ?? new Date('2026-06-01T00:00:00.000Z'),
  endAt: overrides.endAt ?? new Date('2026-06-30T00:00:00.000Z'),
});

describe('ClubPromotionRepository', () => {
  let repository: ClubPromotionRepository;

  const prismaService = {
    marketingPromotion: { findMany: jest.fn() },
  };
  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers().setSystemTime(NOW);
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPromotionRepository,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    repository = module.get(ClubPromotionRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('只按 endAt 过滤且只查 4 类定价活动（未开始的也要取回算边界）', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);

    await repository.loadActivePromotions(11);

    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 11,
        enabled: true,
        type: {
          in: ['first_order_discount', 'discount', 'discount_day', 'reduce'],
        },
        endAt: { gte: NOW },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        type: true,
        params: true,
        startAt: true,
        endAt: true,
      },
    });
  });

  it('未开始的活动不进结果，但它的开始时间决定 TTL', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      row({
        id: 1,
        startAt: new Date('2026-06-12T12:00:04.000Z'),
        endAt: new Date('2026-06-12T18:00:00.000Z'),
      }),
    ]);

    const result = await repository.loadActivePromotions(11);

    expect(result).toEqual([]);
    // 边界只剩 4s，夹到 TTL 下限 5s（避免 TTL 退化成 1s 让缓存形同虚设）
    expect(redisService.setJson).toHaveBeenCalledWith(CACHE_KEY, [], 5);
  });

  it('已开始活动按 4 类投影返回，TTL 由最近结束边界决定', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      row({ id: 1, endAt: new Date('2026-06-12T12:00:20.000Z') }),
      row({
        id: 2,
        type: 'reduce',
        endAt: new Date('2026-06-12T13:00:00.000Z'),
      }),
    ]);

    const result = await repository.loadActivePromotions(11);

    // 额外字段（startAt/endAt）只用于算边界与过滤，不进定价投影
    expect(result).toEqual([
      { id: 1, name: '活动1', type: 'discount', params: { discountRate: 90 } },
      { id: 2, name: '活动2', type: 'reduce', params: { discountRate: 90 } },
    ]);
    expect(redisService.setJson).toHaveBeenCalledWith(CACHE_KEY, result, 20);
  });

  it('缓存命中时不回源', async () => {
    redisService.getJson.mockResolvedValue([
      { id: 5, name: '缓存活动', type: 'discount', params: {} },
    ]);

    await expect(repository.loadActivePromotions(11)).resolves.toEqual([
      { id: 5, name: '缓存活动', type: 'discount', params: {} },
    ]);
    expect(prismaService.marketingPromotion.findMany).not.toHaveBeenCalled();
  });

  it('Redis 读异常时降级回源（下单定价不能因缓存故障失败）', async () => {
    redisService.getJson.mockRejectedValue(new Error('Redis 不可用'));
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      row({ id: 1 }),
    ]);

    const result = await repository.loadActivePromotions(11);

    expect(result).toHaveLength(1);
    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledTimes(1);
  });

  it('Redis 写异常不影响本次返回', async () => {
    redisService.setJson.mockRejectedValue(new Error('Redis 不可用'));
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      row({ id: 1 }),
    ]);

    await expect(repository.loadActivePromotions(11)).resolves.toHaveLength(1);
  });

  it('并发未命中只回源一次', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      row({ id: 1 }),
    ]);

    await Promise.all([
      repository.loadActivePromotions(11),
      repository.loadActivePromotions(11),
      repository.loadActivePromotions(11),
    ]);

    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledTimes(1);
  });
});
