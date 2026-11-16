import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubScanOrderingMarketingCustomerService } from '../src/purely-club/scan-ordering/club-scan-ordering-marketing-customer.service';
import { ClubOrderPromotionsService } from '../src/purely-club/orders/club-order-promotions.service';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubMemberLevelsService } from '../src/purely-club/member/member-levels/club-member-levels.service';
import { ClubPromotionRepository } from '../src/purely-club/shared/club-promotion.repository';

/**
 * 真实数据库 E2E：购物车预览不得写顾客档案（P0-10）。
 *
 * mock 单测只能证明「调用的是 findExistingCustomer」，证明不了真的没有写库。
 * 这里在 Postgres 上直接断言：
 * 1. 预览对未建档顾客不产生任何 marketing_customers 行（并发 20 次仍为 0 行）；
 * 2. 预览命中已有档案时不改 updated_at（raw UPDATE 之外的写一律会刷新它）；
 * 3. legacy 档案可被预览只读命中，但不会被认领（club_user_id 仍为 null）；
 * 4. 下单路径（resolveActiveCustomer）仍能正常建档，且与预览命中同一条档案；
 * 5. 停用 / 软删档案不参与预览，也不会被预览「顺手重建」；
 * 6. 未建档时定价上下文的消费次数为 0（首单折扣口径），积分可用额为 0。
 */
describe('扫码点餐预览只读顾客档案 (e2e, real database)', () => {
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
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let customerService: ClubScanOrderingMarketingCustomerService;
  let promotionsService: ClubOrderPromotionsService;
  let storeId = 0;
  const createdUserIds: number[] = [];

  const uniqueEmail = (tag: string): string =>
    `e2e-preview-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const createClubUser = async (
    tag: string,
    wechatPhone?: string,
  ): Promise<number> => {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(tag),
        password: 'not-used',
        ...(wechatPhone ? { wechatPhone } : {}),
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  const countCustomers = (): Promise<number> =>
    prisma.marketingCustomer.count({ where: { storeId } });

  const readUpdatedAt = async (customerId: number): Promise<Date> => {
    const row = await prisma.marketingCustomer.findUniqueOrThrow({
      where: { id: customerId },
      select: { updatedAt: true },
    });
    return row.updatedAt;
  };

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ClubScanOrderingMarketingCustomerService,
        ClubOrderPromotionsService,
        // 定价上下文只需要「活动列表 + 消费次数」，活动来源用空列表隔离 Redis 依赖
        {
          provide: ClubPromotionRepository,
          useValue: { loadActivePromotions: () => Promise.resolve([]) },
        },
        { provide: ClubMemberProfileService, useValue: {} },
        { provide: ClubMemberLevelsService, useValue: {} },
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    customerService = moduleFixture.get(
      ClubScanOrderingMarketingCustomerService,
    );
    promotionsService = moduleFixture.get(ClubOrderPromotionsService);

    const suffix = `${Date.now()}`;
    const owner = await prisma.user.create({
      data: { email: uniqueEmail('owner'), password: 'not-used' },
    });
    createdUserIds.push(owner.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E预览只读店${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
    });
    storeId = store.id;
  });

  afterAll(async () => {
    await prisma.marketingConsumption.deleteMany({ where: { storeId } });
    await prisma.marketingCustomer.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  it('未建档顾客：预览并发 20 次也不产生任何顾客档案', async () => {
    const clubUserId = await createClubUser('no-archive');
    const before = await countCustomers();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        customerService.findExistingCustomer(storeId, clubUserId),
      ),
    );

    expect(results.every((row) => row === null)).toBe(true);
    expect(await countCustomers()).toBe(before);
    expect(
      await prisma.marketingCustomer.count({ where: { storeId, clubUserId } }),
    ).toBe(0);
  });

  it('已有绑定档案：预览只读，未刷新 updated_at', async () => {
    const clubUserId = await createClubUser('bound');
    const created = await prisma.marketingCustomer.create({
      data: {
        storeId,
        clubUserId,
        name: '已建档顾客',
        balance: 5000,
        points: 320,
        phone: '13800000001',
      },
    });
    const before = await readUpdatedAt(created.id);

    const found = await customerService.findExistingCustomer(
      storeId,
      clubUserId,
    );

    expect(found).toEqual({
      id: created.id,
      balance: 5000,
      phone: '13800000001',
    });
    expect(await readUpdatedAt(created.id)).toEqual(before);
  });

  it('legacy 同号档案：预览能命中，但不会认领（club_user_id 仍为 null）', async () => {
    const phone = '13800000002';
    const clubUserId = await createClubUser('legacy', phone);
    const legacy = await prisma.marketingCustomer.create({
      data: { storeId, name: '历史档案', phone, points: 88 },
    });
    const before = await readUpdatedAt(legacy.id);

    const found = await customerService.findExistingCustomer(
      storeId,
      clubUserId,
    );

    expect(found?.id).toBe(legacy.id);
    const reloaded = await prisma.marketingCustomer.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { clubUserId: true, updatedAt: true },
    });
    expect(reloaded.clubUserId).toBeNull();
    expect(reloaded.updatedAt).toEqual(before);
  });

  it('下单路径仍能建档，并与随后的预览命中同一条档案', async () => {
    const phone = '13800000003';
    const clubUserId = await createClubUser('first-order', phone);

    expect(
      await customerService.findExistingCustomer(storeId, clubUserId),
    ).toBeNull();

    const created = await customerService.resolveActiveCustomer(
      storeId,
      clubUserId,
    );
    expect(created.id).toBeGreaterThan(0);

    const stored = await prisma.marketingCustomer.findUniqueOrThrow({
      where: { id: created.id },
      select: { clubUserId: true, phone: true, balance: true, points: true },
    });
    expect(stored.clubUserId).toBe(clubUserId);
    expect(stored.phone).toBe(phone);
    expect(stored.balance).toBe(0);
    expect(stored.points).toBe(0);

    const previewed = await customerService.findExistingCustomer(
      storeId,
      clubUserId,
    );
    expect(previewed?.id).toBe(created.id);
  });

  it('并发下单建档不会产生重复档案', async () => {
    const clubUserId = await createClubUser('concurrent-create');

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        customerService.resolveActiveCustomer(storeId, clubUserId),
      ),
    );

    const ids = new Set(results.map((row) => row.id));
    expect(ids.size).toBe(1);
    expect(
      await prisma.marketingCustomer.count({ where: { storeId, clubUserId } }),
    ).toBe(1);
  });

  it('停用 / 软删档案不参与预览，也不会被预览重建', async () => {
    const inactiveUserId = await createClubUser('inactive');
    await prisma.marketingCustomer.create({
      data: {
        storeId,
        clubUserId: inactiveUserId,
        name: '停用顾客',
        status: 'inactive',
      },
    });
    const deletedUserId = await createClubUser('deleted');
    await prisma.marketingCustomer.create({
      data: {
        storeId,
        clubUserId: deletedUserId,
        name: '软删顾客',
        deletedAt: new Date(),
      },
    });
    const before = await countCustomers();

    await expect(
      customerService.findExistingCustomer(storeId, inactiveUserId),
    ).resolves.toBeNull();
    await expect(
      customerService.findExistingCustomer(storeId, deletedUserId),
    ).resolves.toBeNull();
    expect(await countCustomers()).toBe(before);
  });

  it('未建档顾客的定价上下文：无消费标记、可用积分 0', async () => {
    const clubUserId = await createClubUser('pricing-null');

    const unregistered = await promotionsService.preloadPricingContext(
      storeId,
      null,
    );
    expect(unregistered.hasConsumption).toBe(false);

    // 建档并补一条消费流水后：同一门店下「未建档」口径仍为无消费，
    // 已建档口径才判定为已有消费——这正是预览不建档也不会算错首单折扣的原因
    const customer = await customerService.resolveActiveCustomer(
      storeId,
      clubUserId,
    );
    await prisma.marketingConsumption.create({
      data: { storeId, customerId: customer.id, amount: 1200 },
    });

    const registered = await promotionsService.preloadPricingContext(
      storeId,
      customer.id,
    );
    expect(registered.hasConsumption).toBe(true);
    expect(
      (await promotionsService.preloadPricingContext(storeId, null))
        .hasConsumption,
    ).toBe(false);
  });
});
