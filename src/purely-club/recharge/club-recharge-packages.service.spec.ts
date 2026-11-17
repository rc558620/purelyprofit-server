import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubRechargePackagesCacheKey } from '../../redis/keys/club-cache-keys';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { ClubRechargeOrderStoreService } from './club-recharge-order-store.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import {
  CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS,
  CLUB_RECHARGE_PREVIEW_COUNT,
} from './club-recharge.constants';
import { DEFAULT_CLUB_RECHARGE_PACKAGES } from './club-recharge.types';

const STORE_ID = 31;
const CACHE_KEY = buildClubRechargePackagesCacheKey(STORE_ID);

const promotion = (id: number): Record<string, unknown> => ({
  id,
  name: `储值赠${id}`,
  description: '最受欢迎',
  params: { rechargeAmount: 10000 * id, giftAmount: 1000 * id },
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
});

describe('ClubRechargePackagesService 充值套餐缓存', () => {
  let service: ClubRechargePackagesService;

  /*
   * 缓存全链路都在这个服务里：回源查询、60s 写缓存、命中直接返回、
   * Redis 故障降级、并发单飞。任一条退化都会让充值页首屏重新压回
   * marketing_promotions（C 端最高频的入口之一）。
   */
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
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);
    prismaService.marketingPromotion.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubRechargePackagesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get(ClubRechargePackagesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('未命中时回源一次，并按 60s TTL 写入门店维度 key', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([promotion(2)]);

    const packages = await service.loadPackagesForStore(STORE_ID);

    expect(packages).toEqual([
      {
        id: '2',
        amount: 200,
        bonusAmount: 20,
        tag: '最受欢迎',
        recommended: true,
      },
    ]);
    expect(redisService.setJson).toHaveBeenCalledWith(
      CACHE_KEY,
      packages,
      CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS,
    );
  });

  it('缓存命中时不再回源营销活动', async () => {
    const cached = [
      { id: '9', amount: 999, bonusAmount: 99, recommended: true },
    ];
    redisService.getJson.mockResolvedValue(cached);

    await expect(service.loadPackagesForStore(STORE_ID)).resolves.toBe(cached);
    expect(prismaService.marketingPromotion.findMany).not.toHaveBeenCalled();
  });

  it('无充赠活动时缓存默认套餐（空结果同样进缓存，不每次回源）', async () => {
    const packages = await service.loadPackagesForStore(STORE_ID);

    expect(packages).toEqual(DEFAULT_CLUB_RECHARGE_PACKAGES);
    // 返回的是副本：调用方改写不会污染默认套餐常量
    expect(packages[0]).not.toBe(DEFAULT_CLUB_RECHARGE_PACKAGES[0]);
    expect(redisService.setJson).toHaveBeenCalledWith(
      CACHE_KEY,
      packages,
      CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS,
    );
  });

  it('并发未命中只回源一次（进程内单飞）', async () => {
    prismaService.marketingPromotion.findMany.mockResolvedValue([promotion(1)]);

    await Promise.all([
      service.loadPackagesForStore(STORE_ID),
      service.loadPackagesForStore(STORE_ID),
      service.loadPackagesForStore(STORE_ID),
    ]);

    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledTimes(1);
    // 单飞命中后只有首个请求写缓存
    expect(redisService.setJson).toHaveBeenCalledTimes(1);
  });

  it('Redis 读异常降级回源，写异常不影响本次返回', async () => {
    redisService.getJson.mockRejectedValue(new Error('Redis 不可用'));
    redisService.setJson.mockRejectedValue(new Error('Redis 不可用'));
    prismaService.marketingPromotion.findMany.mockResolvedValue([promotion(3)]);

    const packages = await service.loadPackagesForStore(STORE_ID);

    expect(packages).toHaveLength(1);
    expect(packages[0]!.id).toBe('3');
    expect(prismaService.marketingPromotion.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('ClubRechargeQueryService 预览切片（缓存后仍只取前 N 条）', () => {
  const buildService = (
    packages: Awaited<
      ReturnType<ClubRechargePackagesService['loadPackagesForStore']>
    >,
  ): ClubRechargeQueryService => {
    const packagesService = {
      loadPackagesForStore: jest.fn().mockResolvedValue(packages),
    };
    return new ClubRechargeQueryService(
      packagesService as unknown as ClubRechargePackagesService,
      { getDraft: jest.fn() } as unknown as ClubOrderDraftsService,
      {
        findDraftSnapshot: jest.fn(),
      } as unknown as ClubRechargeOrderStoreService,
    );
  };

  const context = { store: { id: STORE_ID } } as never;

  it('preview=true 只返回前 N 条，且 N 与常量一致', async () => {
    const packages = DEFAULT_CLUB_RECHARGE_PACKAGES.map((item) => ({
      ...item,
    }));
    const service = buildService(packages);

    const preview = await service.listPackages(context, { preview: true });

    expect(preview.items).toHaveLength(CLUB_RECHARGE_PREVIEW_COUNT);
    expect(preview.items).toEqual(
      packages.slice(0, CLUB_RECHARGE_PREVIEW_COUNT),
    );
  });

  it('非预览返回缓存里的完整套餐列表（切片只在预览路径发生）', async () => {
    const packages = DEFAULT_CLUB_RECHARGE_PACKAGES.map((item) => ({
      ...item,
    }));
    const service = buildService(packages);

    const all = await service.listPackages(context, {});

    expect(all.items).toEqual(packages);
  });
});
