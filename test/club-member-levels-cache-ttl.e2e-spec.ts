import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { CLUB_LEVEL_SETTINGS_CACHE_TTL_MS } from '../src/purely-club/member/member-levels/club-member-levels.cache';
import { ClubMemberLevelsService } from '../src/purely-club/member/member-levels/club-member-levels.service';
import { fetchPointsRedeemConfig } from '../src/purely-club/orders/club-order-points.utils';

/**
 * 真实数据库 E2E：3-B-2「等级配置进程内 TTL 缓存的可见延迟有界」。
 *
 * 要证明的事只有跑真库 + 真时钟才能证明：
 * 1. TTL 窗口内改配置，C 端仍读旧值（缓存确实生效，少读库）；
 * 2. 越过 TTL 后自动读到新值（延迟有界、不需要重启或人工失效）；
 * 3. `pointsRatio` 不在缓存内 —— 资金口径保持实时。
 *
 * 这里用真实 sleep（约 3s），不伪造时钟：真库读 + 真 TTL 判定才是要验的东西。
 */
describe('C 端会员等级配置 TTL 缓存 (e2e, real database)', () => {
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
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let levelsService: ClubMemberLevelsService;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdStoreIds: number[] = [];
  const createdUserIds: number[] = [];

  const buildLevels = (goldDiscountRate: number): unknown => [
    {
      id: 'gold',
      name: '黄金会员',
      discountRate: goldDiscountRate,
      discountRatePct: Math.round(goldDiscountRate * 100),
      spendThreshold: 0,
      description: '充值即享折扣',
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

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ClubMemberLevelsService,
      ],
    }).compile();
    await moduleFixture.init();

    prisma = moduleFixture.get(PrismaService);
    levelsService = moduleFixture.get(ClubMemberLevelsService);
  });

  afterAll(async () => {
    if (prisma) {
      if (createdStoreIds.length > 0) {
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

  it('TTL 内读旧配置、越界后自动生效，且 pointsRatio 不走缓存', async () => {
    const owner = await prisma.user.create({
      data: { email: `e2e-levels-ttl-${suffix}@test.local`, password: 'x' },
    });
    createdUserIds.push(owner.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E等级缓存${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
      select: { id: true },
    });
    createdStoreIds.push(store.id);

    const pointsRatioV1 = {
      earnRatioCents: 100,
      redeemRatioPoints: 100,
      maxRedeemRatio: 0.5,
      enabled: true,
      updatedAt: 0,
    };

    await prisma.marketingMemberLevelSetting.create({
      data: {
        storeId: store.id,
        levels: buildLevels(0.9) as never,
        pointsRatio: pointsRatioV1 as never,
      },
    });

    const findUnique = jest.spyOn(
      prisma.marketingMemberLevelSetting,
      'findUnique',
    );

    // ① 首次回源
    const first = await levelsService.listConfigs(store.id);
    expect(first[0].discountRate).toBe(0.9);
    expect(findUnique).toHaveBeenCalledTimes(1);

    // ② 后台改折扣率，TTL 内仍读旧值且不再回源
    await prisma.marketingMemberLevelSetting.update({
      where: { storeId: store.id },
      data: { levels: buildLevels(0.88) as never },
    });

    const withinTtl = await levelsService.listConfigs(store.id);
    expect(withinTtl[0].discountRate).toBe(0.9);
    expect(findUnique).toHaveBeenCalledTimes(1);

    // ③ 越过 TTL 后自动读到新值（无需重启 / 人工失效）
    await sleep(CLUB_LEVEL_SETTINGS_CACHE_TTL_MS + 300);

    const afterTtl = await levelsService.listConfigs(store.id);
    expect(afterTtl[0].discountRate).toBe(0.88);
    expect(findUnique).toHaveBeenCalledTimes(2);

    findUnique.mockRestore();

    // ④ pointsRatio 不在本缓存内：改完由积分消费方立刻读到（资金口径零延迟）
    await prisma.marketingMemberLevelSetting.update({
      where: { storeId: store.id },
      data: {
        pointsRatio: { ...pointsRatioV1, maxRedeemRatio: 0.2 } as never,
      },
    });

    const redeemConfig = await fetchPointsRedeemConfig(prisma, store.id);
    expect(redeemConfig.maxRedeemRatio).toBe(0.2);
  });
});
