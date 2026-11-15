import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import {
  buildClubPromotionListCacheKey,
  buildClubPromotionsCacheKey,
} from '../src/redis/keys/club-cache-keys';
import { ClubMemberService } from '../src/purely-club/member/club-member.service';
import { ClubMemberBenefitsService } from '../src/purely-club/member/member-benefits/club-member-benefits.service';
import { ClubMemberLevelsService } from '../src/purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubMemberTransactionsService } from '../src/purely-club/member/member-transactions/club-member-transactions.service';
import { ClubProductCacheService } from '../src/purely-club/products/club-product-cache.service';
import { ClubProductPromotionService } from '../src/purely-club/products/club-product-promotion.service';
import { ClubProductQueryService } from '../src/purely-club/products/club-product-query.service';
import { ClubProductViewService } from '../src/purely-club/products/club-product-view.service';
import { ClubProductsService } from '../src/purely-club/products/club-products.service';
import { ClubPromotionRepository } from '../src/purely-club/shared/club-promotion.repository';
import { ClubPromotionsService } from '../src/purely-club/promotions/club-promotions.service';
import { ClubStoresService } from '../src/purely-club/stores/club-stores.service';
import type { ClubCurrentContext } from '../src/purely-club/stores/club-stores.types';
import { ClubHomeService } from '../src/purely-club/home/club-home.service';
import { AuthService } from '../src/purely-profit/auth/auth.service';

/**
 * 真实数据库 + 真实 Redis E2E：3-B-4「首页一次加载只读一次会员等级配置」。
 *
 * 只有跑真环境才能证明的事：一次 `getHome` 里
 * `marketing_member_level_settings` 表到底被查了几次。
 * 单测里三条分支全被 mock，看不到真实时序（Redis 往返导致 in-flight 窗口错过）。
 *
 * 计数方式：对 `marketingMemberLevelSetting.findUnique` 做 spy，**保留真实实现**，
 * 因此既能命中真实库、又能精确统计次数。
 *
 * Redis 装配真实 RedisService（会员快照 15s 缓存、活动缓存、商品缓存全走真实链路）；
 * 每个用例使用独立门店，避免跨用例串缓存。
 */
describe('C 端首页等级配置单次读取 (e2e, real database + real redis)', () => {
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
  let homeService: ClubHomeService;

  const createdStoreIds: number[] = [];
  const createdOwnerIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdCustomerIds: number[] = [];
  const createdMemberIds: number[] = [];

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createStore = async (tag: string): Promise<number> => {
    const owner = await prisma.user.create({
      data: { email: `e2e-home-${tag}-${suffix}@test.local`, password: 'x' },
    });
    createdOwnerIds.push(owner.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E首页等级${tag}-${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
      select: { id: true },
    });
    createdStoreIds.push(store.id);
    return store.id;
  };

  /** C 端账号：手机号即登录凭据，快照按 (storeId, clubUserId) 两层锚定命中档案 */
  const createClubUser = async (tag: string): Promise<number> => {
    const user = await prisma.user.create({
      data: {
        email: `club_phone_${tag}-${suffix}@purelyprofit.local`,
        password: 'x',
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  /** 门店内唯一手机号：同一门店只会有一条同号顾客档案 */
  const buildPhone = (storeId: number): string =>
    `13${String(storeId).padStart(9, '0')}`;

  const LEVELS_ALL_ENABLED = [
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

  const withDisabledLevel = (
    levels: typeof LEVELS_ALL_ENABLED,
    disabledId: string,
  ): typeof LEVELS_ALL_ENABLED =>
    levels.map((level) =>
      level.id === disabledId ? { ...level, enabled: false } : level,
    );

  const seedLevelSettings = async (
    storeId: number,
    levels: unknown,
  ): Promise<void> => {
    await prisma.marketingMemberLevelSetting.create({
      data: { storeId, levels: levels as never },
    });
  };

  const seedMemberWithCustomer = async (params: {
    storeId: number;
    clubUserId: number;
    phone: string;
    tier: 'regular' | 'gold' | 'diamond';
    balanceCents: number;
    rechargeCents: number;
  }): Promise<{ memberId: number; customerId: number }> => {
    const customer = await prisma.marketingCustomer.create({
      data: {
        storeId: params.storeId,
        clubUserId: params.clubUserId,
        name: 'E2E 会员',
        phone: params.phone,
        tier: params.tier,
        balance: params.balanceCents,
        points: 120,
      },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    const member = await prisma.member.create({
      data: {
        storeId: params.storeId,
        clubUserId: params.clubUserId,
        customerId: customer.id,
        name: 'E2E 会员',
        phone: params.phone,
      },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    if (params.rechargeCents > 0) {
      await prisma.marketingRecharge.create({
        data: {
          storeId: params.storeId,
          customerId: customer.id,
          amount: params.rechargeCents,
          totalAmount: params.rechargeCents,
          type: 'recharge',
        },
      });
    }

    return { memberId: member.id, customerId: customer.id };
  };

  const seedProduct = async (
    storeId: number,
    params: { name: string; price: number },
  ): Promise<void> => {
    const category = await prisma.marketingProductCategory.create({
      data: { storeId, name: `E2E分类-${params.name}` },
      select: { id: true },
    });
    await prisma.marketingProduct.create({
      data: {
        storeId,
        categoryId: category.id,
        name: params.name,
        price: params.price,
        stock: 99,
        isActive: true,
      },
    });
  };

  const seedPromotion = async (storeId: number): Promise<void> => {
    const now = Date.now();
    await prisma.marketingPromotion.create({
      data: {
        storeId,
        name: 'E2E 95折活动',
        type: 'discount',
        description: '',
        params: { discountRate: 95 },
        startAt: new Date(now - 600_000),
        endAt: new Date(now + 3_600_000),
        enabled: true,
      },
    });
  };

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

    // ClubStoresService.getCurrent 只是「把 context.store 映射成首页门店摘要」的
    // 纯展示转换，与本用例关注的「等级配置读取次数」无关，用最小 stub 避免
    // 拉起整条门店访问链路（本用例的重点是会员/定价分支的库读取）。
    const clubStoresServiceStub = {
      getCurrent: (currentContext: ClubCurrentContext) => ({
        id: String(currentContext.store.id),
        name: currentContext.store.name,
        address: currentContext.store.address,
        businessMode: currentContext.store.businessMode,
      }),
    };

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: ClubStoresService, useValue: clubStoresServiceStub },
        // 改头像 / 改昵称 / 权益 / 流水不在首页链路内，最小 stub 占位
        { provide: AuthService, useValue: {} },
        { provide: ClubMemberBenefitsService, useValue: {} },
        { provide: ClubMemberTransactionsService, useValue: {} },
        PrismaService,
        RedisService,
        ClubMemberProfileService,
        ClubMemberLevelsService,
        ClubMemberService,
        ClubProductCacheService,
        ClubProductQueryService,
        ClubProductViewService,
        ClubProductPromotionService,
        ClubProductsService,
        ClubPromotionRepository,
        ClubPromotionsService,
        ClubHomeService,
      ],
    }).compile();
    await moduleFixture.init();

    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    homeService = moduleFixture.get(ClubHomeService);
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
        // Member.customerId 外键指向顾客档案，必须先删会员再删顾客
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
        await prisma.marketingPromotion.deleteMany({
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
      if (createdOwnerIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdOwnerIds } },
        });
      }
      await prisma.$disconnect();
    }
    await moduleFixture.close();
  });

  it('会员在店（等级全启用）：一次 getHome 只读一次等级配置，三处结果与改动前一致', async () => {
    const storeId = await createStore('all');
    const clubUserId = await createClubUser('all');
    const phone = buildPhone(storeId);
    await seedLevelSettings(storeId, LEVELS_ALL_ENABLED);
    await seedMemberWithCustomer({
      storeId,
      clubUserId,
      phone,
      tier: 'gold',
      balanceCents: 35_000,
      rechargeCents: 320_000,
    });
    await seedProduct(storeId, { name: '经典养护套餐', price: 19_900 });
    await seedPromotion(storeId);

    const context = buildContext({
      userId: clubUserId,
      storeId,
      storeName: `E2E首页等级all-${suffix}`,
      phone,
    });

    const findUnique = jest.spyOn(
      prisma.marketingMemberLevelSetting,
      'findUnique',
    );

    const result = await homeService.getHome(context);

    // ① 一次 getHome 内等级配置表只被读一次
    expect(findUnique).toHaveBeenCalledTimes(1);
    findUnique.mockRestore();

    // ② 三处消费方结果与改动前一致
    expect(result.currentStore).toEqual(
      expect.objectContaining({ id: String(storeId) }),
    );
    expect(result.accountStatus).toBe('active');
    expect(result.levelConfigs.map((item) => item.level)).toEqual([
      'gold',
      'platinum',
      'diamond',
    ]);
    expect(result.levelConfigs[0]).toEqual(
      expect.objectContaining({
        level: 'gold',
        label: '黄金会员',
        discountRate: 0.9,
        discountText: '9折',
        upgradeHintText: '充值即享',
      }),
    );
    // 账户等级：累计充值 3200 元 ≥ platinum(1000) 门槛
    expect(result.account).toEqual(
      expect.objectContaining({
        level: 'platinum',
        heldLevel: 'gold',
        heldLevelLabel: '黄金会员',
        heldLevelVisible: true,
        totalConsume: 3_200,
        balance: 350,
        points: 120,
      }),
    );
    // 定价上下文：当前等级 platinum 的 0.85 折扣率必须照常传出
    expect(result.featuredProducts).toHaveLength(1);
    expect(result.featuredProducts[0]).toEqual(
      expect.objectContaining({
        name: '经典养护套餐',
        memberPrice: 199,
        memberDiscountRate: 0.85,
      }),
    );
    expect(result.promotions).toHaveLength(1);
    expect(result.promotions[0]).toEqual(
      expect.objectContaining({ name: 'E2E 95折活动' }),
    );
  });

  it('顾客持有已停用等级：heldLevel 与 heldLevelLabel 不丢，且仍只读一次配置', async () => {
    const storeId = await createStore('held');
    const clubUserId = await createClubUser('held');
    const phone = buildPhone(storeId);
    // 停用 diamond（顾客 tier=diamond）：构造「已停用等级但顾客仍持有」
    await seedLevelSettings(
      storeId,
      withDisabledLevel(LEVELS_ALL_ENABLED, 'diamond'),
    );
    await seedMemberWithCustomer({
      storeId,
      clubUserId,
      phone,
      tier: 'diamond',
      balanceCents: 0,
      rechargeCents: 0,
    });

    const context = buildContext({
      userId: clubUserId,
      storeId,
      storeName: `E2E首页等级held-${suffix}`,
      phone,
    });

    const findUnique = jest.spyOn(
      prisma.marketingMemberLevelSetting,
      'findUnique',
    );

    const result = await homeService.getHome(context);

    expect(findUnique).toHaveBeenCalledTimes(1);
    findUnique.mockRestore();

    // 等级列表口径 = 可见等级（停用的 diamond 不出现）
    expect(result.levelConfigs.map((item) => item.level)).toEqual([
      'gold',
      'platinum',
    ]);
    expect(result.account).toEqual(
      expect.objectContaining({
        heldLevel: 'diamond',
        // 已停用等级仍取**原始配置**的 label，不能退化成常量兜底
        heldLevelLabel: '钻石会员',
        heldLevelVisible: false,
      }),
    );
    // 无充值：currentLevel 回落为普通会员
    expect(result.account?.level).toBe('regular');
  });

  it('等级配置读失败：三条分支各自降级，互不连坐', async () => {
    const storeId = await createStore('degrade');
    const clubUserId = await createClubUser('degrade');
    const phone = buildPhone(storeId);
    await seedLevelSettings(storeId, LEVELS_ALL_ENABLED);
    await seedMemberWithCustomer({
      storeId,
      clubUserId,
      phone,
      tier: 'gold',
      balanceCents: 10_000,
      rechargeCents: 100_000,
    });
    await seedProduct(storeId, { name: '降级场景商品', price: 9_900 });

    const context = buildContext({
      userId: clubUserId,
      storeId,
      storeName: `E2E首页等级degrade-${suffix}`,
      phone,
    });

    const findUnique = jest.spyOn(
      prisma.marketingMemberLevelSetting,
      'findUnique',
    );
    findUnique.mockRejectedValue(new Error('等级配置表不可用'));

    try {
      const result = await homeService.getHome(context);

      // 口径与改动前一致：等级列表 []、账户 unavailable、商品 []
      expect(result.levelConfigs).toEqual([]);
      expect(result.account).toBeNull();
      expect(result.accountStatus).toBe('unavailable');
      expect(result.featuredProducts).toEqual([]);
      // 非等级配置依赖的分支不受牵连
      expect(result.currentStore).toEqual(
        expect.objectContaining({ id: String(storeId) }),
      );
      expect(result.promotions).toEqual([]);
    } finally {
      findUnique.mockRestore();
    }
  });
});
