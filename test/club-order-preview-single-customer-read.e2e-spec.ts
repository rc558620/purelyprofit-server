import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import {
  buildClubPromotionListCacheKey,
  buildClubPromotionsCacheKey,
} from '../src/redis/keys/club-cache-keys';
import { ClubMemberLevelsService } from '../src/purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubOrderPreviewBreakdownService } from '../src/purely-club/orders/club-order-preview-breakdown.service';
import { ClubOrderPreviewService } from '../src/purely-club/orders/club-order-preview.service';
import { ClubOrderPromotionsService } from '../src/purely-club/orders/club-order-promotions.service';
import { ClubOrderServiceContextService } from '../src/purely-club/orders/club-order-service-context.service';
import { ClubPromotionRepository } from '../src/purely-club/shared/club-promotion.repository';
import type { ClubCurrentContext } from '../src/purely-club/stores/club-stores.types';

/**
 * 真实数据库 + 真实 Redis E2E：3-B-5「订单预览不重复读同一行顾客档案」。
 *
 * 验证两件事：
 * 1. 一次 `previewServiceOrder` 内 `marketing_customers` 的**按 id 读取**只有 1 次
 *    （积分与余额同源），此前是 points / balance 各查一次；
 * 2. 价格与积分抵扣口径与改动前一致（会员折扣竞争、积分封顶、余额判断）。
 *
 * 计数方式：spy `marketingCustomer.findUnique` 且**保留真实实现**，同时命中真实库。
 * 门店定位（`findFirst` 两层锚定）单独计数，用来证明「定位」与「资产读取」是两条路径。
 */
describe('C 端订单预览顾客行单次读取 (e2e, real database + real redis)', () => {
  jest.setTimeout(30_000);

  const envConfig = new ConfigService();

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return envConfig.get<string>('DATABASE_URL');
        case 'database.poolMax':
          return 10;
        case 'database.poolMin':
          return 1;
        case 'database.poolIdleTimeoutMs':
          return 30_000;
        case 'database.poolConnectionTimeoutMs':
          return 5_000;
        case 'database.statementTimeoutMs':
          return 10_000;
        case 'database.pgMaxConnections':
          return 100;
        case 'app.slowQueryLogEnabled':
          return false;
        case 'app.slowQueryThresholdMs':
          return 80;
        case 'app.sqlMetricsEnabled':
          return false;
        case 'app.slowRedisLogEnabled':
          return false;
        case 'app.slowRedisThresholdMs':
          return 20;
        case 'redis.host':
          return envConfig.get<string>('REDIS_HOST') ?? 'localhost';
        case 'redis.port':
          return Number(envConfig.get<string>('REDIS_PORT') ?? 6379);
        case 'redis.password':
          return envConfig.get<string>('REDIS_PASSWORD') ?? '';
        case 'redis.db':
          return Number(envConfig.get<string>('REDIS_DB') ?? 0);
        case 'redis.connectTimeoutMs':
          return 5_000;
        case 'redis.commandTimeoutMs':
          return 3_000;
        case 'redis.maxRetriesPerRequest':
          return 3;
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  let prisma: PrismaService;
  let redis: RedisService;
  let moduleFixture: TestingModule;
  let previewService: ClubOrderPreviewService;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdStoreIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdCustomerIds: number[] = [];
  const createdMemberIds: number[] = [];

  const LEVELS = [
    {
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      discountRatePct: 90,
      spendThreshold: 0,
      description: '充值即享 9 折优惠',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
    {
      id: 'platinum',
      name: '铂金会员',
      discountRate: 0.85,
      discountRatePct: 85,
      spendThreshold: 1_000,
      description: '累计充值 ≥ ¥1,000 升级',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
    {
      id: 'diamond',
      name: '钻石会员',
      discountRate: 0.8,
      discountRatePct: 80,
      spendThreshold: 5_000,
      description: '累计充值 ≥ ¥5,000 升级',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
  ];

  const buildContext = (params: {
    userId: number;
    storeId: number;
    storeName: string;
    phone: string;
  }): ClubCurrentContext =>
    ({
      user: {
        id: params.userId,
        email: `club_phone_${params.phone}@purelyprofit.local`,
        phone: params.phone,
        name: 'E2E 会员',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastActiveAt: null,
        accountScope: 'purely_club',
        currentMembership: null,
      },
      store: {
        id: params.storeId,
        name: params.storeName,
        address: '北京市朝阳区望京 SOHO T3 B1',
        businessMode: 'general',
        memberCareEnabled: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    }) as unknown as ClubCurrentContext;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        RedisService,
        ClubMemberProfileService,
        ClubMemberLevelsService,
        ClubPromotionRepository,
        ClubOrderPromotionsService,
        ClubOrderServiceContextService,
        ClubOrderPreviewBreakdownService,
        ClubOrderPreviewService,
      ],
    }).compile();
    await moduleFixture.init();

    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    previewService = moduleFixture.get(ClubOrderPreviewService);
  });

  afterAll(async () => {
    if (prisma) {
      for (const storeId of createdStoreIds) {
        await redis.del(buildClubPromotionsCacheKey(storeId));
        await redis.del(buildClubPromotionListCacheKey(storeId));
      }
      if (createdCustomerIds.length > 0) {
        await prisma.marketingRecharge.deleteMany({
          where: { customerId: { in: createdCustomerIds } },
        });
      }
      if (createdMemberIds.length > 0) {
        await prisma.member.deleteMany({
          where: { id: { in: createdMemberIds } },
        });
      }
      if (createdCustomerIds.length > 0) {
        await prisma.marketingCustomer.deleteMany({
          where: { id: { in: createdCustomerIds } },
        });
      }
      if (createdStoreIds.length > 0) {
        await prisma.marketingProduct.deleteMany({
          where: { storeId: { in: createdStoreIds } },
        });
        await prisma.marketingProductCategory.deleteMany({
          where: { storeId: { in: createdStoreIds } },
        });
        await prisma.marketingMemberLevelSetting.deleteMany({
          where: { storeId: { in: createdStoreIds } },
        });
        await prisma.store.deleteMany({
          where: { id: { in: createdStoreIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await prisma.$disconnect();
    }
    await moduleFixture.close();
  });

  it('一次预览只按 id 读一次顾客行，且价格与积分口径不变', async () => {
    const owner = await prisma.user.create({
      data: { email: `e2e-preview-owner-${suffix}@test.local`, password: 'x' },
    });
    createdUserIds.push(owner.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E预览${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
      select: { id: true },
    });
    createdStoreIds.push(store.id);

    const clubUser = await prisma.user.create({
      data: {
        email: `club_phone_preview-${suffix}@purelyprofit.local`,
        password: 'x',
      },
      select: { id: true },
    });
    createdUserIds.push(clubUser.id);

    const phone = `13${String(store.id).padStart(9, '0')}`;

    const customer = await prisma.marketingCustomer.create({
      data: {
        storeId: store.id,
        clubUserId: clubUser.id,
        name: 'E2E 会员',
        phone,
        tier: 'gold',
        balance: 100_000,
        points: 5_000,
      },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    const member = await prisma.member.create({
      data: {
        storeId: store.id,
        clubUserId: clubUser.id,
        customerId: customer.id,
        name: 'E2E 会员',
        phone,
      },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    // 累计充值 ¥100 → currentLevel 命中 gold（9 折），让会员折扣参与竞争
    await prisma.marketingRecharge.create({
      data: {
        storeId: store.id,
        customerId: customer.id,
        amount: 10_000,
        totalAmount: 10_000,
        type: 'recharge',
      },
    });

    await prisma.marketingMemberLevelSetting.create({
      data: {
        storeId: store.id,
        levels: LEVELS as never,
        pointsRatio: {
          earnRatioCents: 100,
          redeemRatioPoints: 100,
          maxRedeemRatio: 0.5,
          enabled: true,
          updatedAt: 0,
        } as never,
      },
    });

    const category = await prisma.marketingProductCategory.create({
      data: { storeId: store.id, name: `E2E分类-${suffix}` },
      select: { id: true },
    });
    const product = await prisma.marketingProduct.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: '经典养护套餐',
        price: 10_000,
        stock: 20,
        isActive: true,
      },
      select: { id: true },
    });

    const context = buildContext({
      userId: clubUser.id,
      storeId: store.id,
      storeName: `E2E预览${suffix}`,
      phone,
    });

    const findUnique = jest.spyOn(prisma.marketingCustomer, 'findUnique');
    const findFirst = jest.spyOn(prisma.marketingCustomer, 'findFirst');

    const result = await previewService.previewServiceOrder(context, {
      storeId: store.id,
      productId: product.id,
      quantity: 1,
      usePoints: true,
    });

    // ① 同一顾客行只按 id 读一次（此前 points / balance 各一次）
    expect(findUnique).toHaveBeenCalledTimes(1);
    // ② 定位仍走 (storeId, clubUserId) 权威锚点，全部一次命中，不回落手机号认领
    const locateWhereClauses = findFirst.mock.calls.map(
      ([args]) => args?.where,
    );
    expect(locateWhereClauses.length).toBeGreaterThan(0);
    locateWhereClauses.forEach((where) => {
      expect(where).toEqual(
        expect.objectContaining({ clubUserId: clubUser.id }),
      );
      expect(where).not.toHaveProperty('phone');
    });

    findUnique.mockRestore();
    findFirst.mockRestore();

    // ③ 金额与积分口径：会员 9 折胜出 → 应付 ¥90；5000 积分抵 50% 封顶 ¥45
    expect(result.originalPrice).toBe(100);
    expect(result.memberBaselinePrice).toBe(100);
    expect(result.afterDiscountPrice).toBe(90);
    expect(result.finalPrice).toBe(90);
    expect(result.pointsDeductionAmount).toBe(45);
    expect(result.pointsUsed).toBe(4500);
    expect(result.afterPointsPrice).toBe(45);
    expect(result.totalSavingWithPoints).toBe(55);
    expect(result.balanceEnough).toBe(true);
    expect(result.insufficientBalanceMessage).toBeNull();
    expect(result.quantity).toBe(1);
  });
});
