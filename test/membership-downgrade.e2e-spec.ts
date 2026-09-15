import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import type { AuthenticatedUser } from '../src/purely-profit/auth/strategies/jwt.strategy';
import {
  ADDITIONAL_BLOCKED_MESSAGE,
  MANUAL_ENTRY_DAILY_LIMIT,
  MEMBERSHIP_EXPIRED_ERROR_CODE,
  MembershipDowngradeService,
  SCAN_ORDER_BLOCKED_MESSAGE,
  SPACE_OPEN_BLOCKED_MESSAGE,
} from '../src/purely-profit/member/platform-membership/membership-downgrade.service';
import { ClubScanOrderingCartService } from '../src/purely-club/scan-ordering/club-scan-ordering-cart.service';

/**
 * 会员到期限制 E2E（真实数据库）。
 *
 * 为什么需要这一层：会员限制的判定条件是「当前时间 > 会员到期时间」，
 * 靠等真实时间流逝无法测试；单元测试里的 profile 是手工构造的对象，
 * 无法覆盖真实数据形态（NULL / 枚举 / 时区 / 关联表计数）。
 *
 * 本测试直接往库里写各种会员档案状态，再走真实 Service 判定，
 * 覆盖三件最容易出事的事：
 *   1. 「到期」与「从未开通」是否被正确区分（判错会把免费商家全部停掉）；
 *   2. 在途订单是否放行（判错会让已下单的顾客卡在半路）；
 *   3. 异常是否带 MEMBERSHIP_EXPIRED 业务码（丢了这个码，
 *      前端会从「引导弹窗」退化成普通报错，顾客看不到该怎么做）。
 *
 * 依赖真实本地 PostgreSQL（DATABASE_URL）；Redis 以最小 mock 注入，
 * 避免引入外部依赖。
 */
describe('会员到期限制 (e2e, real database)', () => {
  let prisma: PrismaService;
  let downgradeService: MembershipDowngradeService;
  let cartService: ClubScanOrderingCartService;
  let moduleFixture: TestingModule;

  const createdStoreIds: number[] = [];
  const createdUserIds: number[] = [];

  /** 手动录单计数的 mock 存储：按 Redis key 存取，让限额逻辑可控 */
  const redisStore = new Map<string, unknown>();

  const redisService = {
    getJson: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    setJson: jest.fn(async (key: string, value: unknown) => {
      redisStore.set(key, value);
    }),
    // 对齐 Redis INCR 语义：原子自增并返回新值，值与 getJson 互通
    incr: jest.fn(async (key: string) => {
      const current = redisStore.get(key);
      const next = (typeof current === 'number' ? current : 0) + 1;
      redisStore.set(key, next);
      return next;
    }),
  };

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return process.env.DATABASE_URL;
        case 'database.poolMax':
          return 5;
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

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        PrismaService,
        MembershipDowngradeService,
        ClubScanOrderingCartService,
      ],
    });

    moduleFixture = await moduleBuilder.compile();
    prisma = moduleFixture.get(PrismaService);
    await prisma.$connect();
    downgradeService = moduleFixture.get(MembershipDowngradeService);
    cartService = moduleFixture.get(ClubScanOrderingCartService);
  });

  afterAll(async () => {
    for (const storeId of [...createdStoreIds].reverse()) {
      try {
        // 购物车项只挂在 session 上（无 storeId），需先取 session id 再级联清理
        const sessionIds = (
          await prisma.scanOrderingSession.findMany({
            where: { storeId },
            select: { id: true },
          })
        ).map((session) => session.id);

        if (sessionIds.length > 0) {
          await prisma.scanOrderingCartItem.deleteMany({
            where: { sessionId: { in: sessionIds } },
          });
        }

        // 按外键依赖顺序清理，任一步失败都不应中断整体清理
        const cleanups: Array<() => Promise<unknown>> = [
          () => prisma.scanOrderingSession.deleteMany({ where: { storeId } }),
          () => prisma.scanOrderingMenuProduct.deleteMany({ where: { storeId } }),
          () => prisma.scanOrderingMenuCategory.deleteMany({ where: { storeId } }),
          () => prisma.scanOrderingTable.deleteMany({ where: { storeId } }),
          () => prisma.product.deleteMany({ where: { storeId } }),
          () => prisma.spaceSession.deleteMany({ where: { storeId } }),
          () => prisma.space.deleteMany({ where: { storeId } }),
          () => prisma.spaceType.deleteMany({ where: { storeId } }),
          () => prisma.storeMembershipProfile.deleteMany({ where: { storeId } }),
          () => prisma.store.deleteMany({ where: { id: storeId } }),
        ];

        for (const cleanup of cleanups) {
          try {
            await cleanup();
          } catch {
            // 忽略清理失败，避免影响其他门店
          }
        }
      } catch {
        // 忽略清理失败，避免影响后续门店
      }
    }
    for (const userId of [...createdUserIds].reverse()) {
      try {
        await prisma.user.deleteMany({ where: { id: userId } });
      } catch {
        // 忽略
      }
    }
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  // ─── 造数工具 ──────────────────────────────────────────────────────────

  let seq = 0;
  const nextSuffix = (): string => `${Date.now()}-${++seq}`;

  async function seedStore(
    label = 'downgrade',
  ): Promise<{ storeId: number; userId: number }> {
    const suffix = nextSuffix();
    const user = await prisma.user.create({
      data: { email: `e2e-${label}-${suffix}@test.local`, password: 'not-used' },
    });
    createdUserIds.push(user.id);

    const store = await prisma.store.create({
      data: {
        name: `E2E会员${label}${suffix}`,
        ownerId: user.id,
        businessMode: 'catering',
      },
    });
    createdStoreIds.push(store.id);

    return { storeId: store.id, userId: user.id };
  }

  /**
   * 写入会员档案；state 决定「到期 / 有效 / 永久 / 从未开通」。
   *
   * 每次改档案都会清掉降级态缓存：真实链路里续费会主动失效缓存，
   * 这里直接改库不会触发失效，若不清理会让后续用例读到上一个用例的状态。
   */
  async function seedMembership(
    storeId: number,
    state: 'expired' | 'active' | 'lifetime' | 'never',
    options: { expiredDaysAgo?: number; remainingDays?: number } = {},
  ): Promise<void> {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    redisStore.clear();

    if (state === 'never') {
      // 从未开通：无套餐、无起止时间。这类门店不应受任何到期限制
      await prisma.storeMembershipProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          currentPlanId: null,
          startsAt: null,
          expiresAt: null,
        },
        update: {
          currentPlanId: null,
          startsAt: null,
          expiresAt: null,
        },
      });
      return;
    }

    if (state === 'lifetime') {
      // 历史永久会员：yearly + 无到期时间 + 有开始时间
      await prisma.storeMembershipProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          currentPlanId: 'yearly',
          startsAt: new Date(now - 500 * DAY),
          expiresAt: null,
        },
        update: {
          currentPlanId: 'yearly',
          startsAt: new Date(now - 500 * DAY),
          expiresAt: null,
        },
      });
      return;
    }

    const expiredAt =
      state === 'expired'
        ? new Date(now - (options.expiredDaysAgo ?? 1) * DAY)
        : new Date(now + (options.remainingDays ?? 30) * DAY);

    await prisma.storeMembershipProfile.upsert({
      where: { storeId },
      create: {
        storeId,
        currentPlanId: state === 'expired' ? 'monthly' : 'yearly',
        startsAt: new Date(now - 90 * DAY),
        expiresAt: expiredAt,
      },
      update: {
        currentPlanId: state === 'expired' ? 'monthly' : 'yearly',
        startsAt: new Date(now - 90 * DAY),
        expiresAt: expiredAt,
      },
    });
  }

  /** 造扫码菜单商品，供 C 端加购链路使用 */
  async function seedMenuProduct(storeId: number): Promise<number> {
    const suffix = nextSuffix();
    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: `热菜${suffix}` },
    });

    const menuProduct = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId: category.id,
        name: `招牌小炒${suffix}`,
        basePrice: 2500,
        stockMode: 'finite',
        stockQuantity: 10,
      },
    });

    return menuProduct.id;
  }

  /**
   * 造扫码点餐会话。
   *
   * createdAt 是「在途放行」判定的关键：到期前创建的会话代表顾客已经开始的
   * 订单流程，必须放行；到期后创建的才算新单，要拦截。
   */
  async function seedScanSession(params: {
    storeId: number;
    clubUserId: number;
    createdAt: Date;
  }): Promise<number> {
    const session = await prisma.scanOrderingSession.create({
      data: {
        storeId: params.storeId,
        clubUserId: params.clubUserId,
        diningRoundId: randomUUID(),
        session: `e2e-session-${nextSuffix()}`,
        status: 'active',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: params.createdAt,
      },
      select: { id: true },
    });

    return session.id;
  }

  /** 造空间（含类型）与会话，用于验证「同时开台数」按真实表计数 */
  async function seedSpaceSession(params: {
    storeId: number;
    status: 'active' | 'settled';
  }): Promise<void> {
    const suffix = nextSuffix();
    const spaceType = await prisma.spaceType.create({
      data: { storeId: params.storeId, name: `台型${suffix}` },
    });
    const space = await prisma.space.create({
      data: {
        storeId: params.storeId,
        typeId: spaceType.id,
        name: `台位${suffix}`,
      },
      select: { id: true },
    });

    await prisma.spaceSession.create({
      data: {
        storeId: params.storeId,
        spaceId: space.id,
        startTime: new Date(),
        billingMode: 'timed',
        status: params.status,
      },
    });
  }

  const buildUser = (id: number): AuthenticatedUser =>
    ({ id, phone: `1380000${String(id).padStart(4, '0')}` }) as AuthenticatedUser;

  /** 捕获异常而不中断，便于断言「是否被会员过期门禁拦截」 */
  const captureError = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
      await fn();
      return null;
    } catch (error) {
      return error;
    }
  };

  /** 是否为「会员已到期」异常（业务码 + 403） */
  const isMembershipExpiredError = (error: unknown): boolean => {
    if (!(error instanceof ForbiddenException)) {
      return false;
    }

    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { code?: unknown }).code === MEMBERSHIP_EXPIRED_ERROR_CODE
    );
  };

  // ─── A. 「到期」与「从未开通」的区分（最关键） ─────────────────────────

  describe('降级态判定（真实会员档案）', () => {
    it('从未开通过的门店不算降级——免费账号不受到期限制', async () => {
      const { storeId } = await seedStore('never');
      await seedMembership(storeId, 'never');

      const state = await downgradeService.getDowngradeState(storeId);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('free');
    });

    it('无会员档案的门店不算降级', async () => {
      const { storeId } = await seedStore('no-profile');

      const state = await downgradeService.getDowngradeState(storeId);

      expect(state.isExpired).toBe(false);
    });

    it('已过期的门店判定为降级', async () => {
      const { storeId } = await seedStore('expired');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 2 });

      const state = await downgradeService.getDowngradeState(storeId);

      expect(state.isExpired).toBe(true);
      expect(state.level).toBe('free');
      expect(state.remainingDays).toBe(0);
    });

    it('有效会员不算降级，且剩余天数正确', async () => {
      const { storeId } = await seedStore('active');
      await seedMembership(storeId, 'active', { remainingDays: 30 });

      const state = await downgradeService.getDowngradeState(storeId);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('yearly');
      expect(state.remainingDays).toBeGreaterThanOrEqual(29);
      expect(state.remainingDays).toBeLessThanOrEqual(31);
    });

    it('历史永久会员（yearly + 无到期时间）不算降级', async () => {
      const { storeId } = await seedStore('lifetime');
      await seedMembership(storeId, 'lifetime');

      const state = await downgradeService.getDowngradeState(storeId);

      expect(state.isExpired).toBe(false);
      expect(state.level).toBe('lifetime');
    });

    it('续费后限制立即解除（无需重启服务）', async () => {
      const { storeId } = await seedStore('renew');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 5 });
      expect((await downgradeService.getDowngradeState(storeId)).isExpired).toBe(true);

      await seedMembership(storeId, 'active', { remainingDays: 365 });

      expect((await downgradeService.getDowngradeState(storeId)).isExpired).toBe(false);
    });
  });

  // ─── B. C 端停新单（真实会话链路） ─────────────────────────────────────

  describe('C 端停新单（扫码点餐加购，真实会话）', () => {
    it('过期门店 + 到期后新建的会话 → 拦截并带业务码', async () => {
      const { storeId, userId } = await seedStore('scan-block');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 3 });
      const menuProductId = await seedMenuProduct(storeId);
      // 会话创建于到期之后 = 新单
      const sessionId = await seedScanSession({
        storeId,
        clubUserId: userId,
        createdAt: new Date(),
      });

      const error = await captureError(() =>
        cartService.addCartItem(buildUser(userId), {
          sessionId,
          productId: menuProductId,
          quantity: 1,
        } as never),
      );

      expect(isMembershipExpiredError(error)).toBe(true);
      const response = (error as ForbiddenException).getResponse() as {
        message?: string;
      };
      expect(response.message).toBe(SCAN_ORDER_BLOCKED_MESSAGE);
    });

    it('过期门店 + 到期前已开始的会话（在途）→ 放行，顾客能完成已开始的订单', async () => {
      const { storeId, userId } = await seedStore('scan-inflight');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });
      const menuProductId = await seedMenuProduct(storeId);
      // 会话创建于到期之前 = 在途
      const sessionId = await seedScanSession({
        storeId,
        clubUserId: userId,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      const error = await captureError(() =>
        cartService.addCartItem(buildUser(userId), {
          sessionId,
          productId: menuProductId,
          quantity: 1,
        } as never),
      );

      // 不应因会员过期被拦（后续可能因其他业务规则失败，那不属于本用例范围）
      expect(isMembershipExpiredError(error)).toBe(false);
    });

    it('从未开通的门店 → 不拦（关键回归：免费商家照常营业）', async () => {
      const { storeId, userId } = await seedStore('scan-free');
      await seedMembership(storeId, 'never');
      const menuProductId = await seedMenuProduct(storeId);
      const sessionId = await seedScanSession({
        storeId,
        clubUserId: userId,
        createdAt: new Date(),
      });

      const error = await captureError(() =>
        cartService.addCartItem(buildUser(userId), {
          sessionId,
          productId: menuProductId,
          quantity: 1,
        } as never),
      );

      expect(isMembershipExpiredError(error)).toBe(false);
    });

    it('有效会员 → 不拦', async () => {
      const { storeId, userId } = await seedStore('scan-active');
      await seedMembership(storeId, 'active', { remainingDays: 100 });
      const menuProductId = await seedMenuProduct(storeId);
      const sessionId = await seedScanSession({
        storeId,
        clubUserId: userId,
        createdAt: new Date(),
      });

      const error = await captureError(() =>
        cartService.addCartItem(buildUser(userId), {
          sessionId,
          productId: menuProductId,
          quantity: 1,
        } as never),
      );

      expect(isMembershipExpiredError(error)).toBe(false);
    });
  });

  // ─── C. B 端追加点单 ───────────────────────────────────────────────────

  describe('B 端追加点单门禁', () => {
    it('过期门店拦截并带业务码', async () => {
      const { storeId } = await seedStore('additional');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });

      const error = await captureError(() =>
        downgradeService.assertAdditionalEnabled(storeId),
      );

      expect(isMembershipExpiredError(error)).toBe(true);
      const response = (error as ForbiddenException).getResponse() as {
        message?: string;
      };
      expect(response.message).toBe(ADDITIONAL_BLOCKED_MESSAGE);
    });

    it('从未开通的免费账号放行（免费版本就含追加点单能力）', async () => {
      const { storeId } = await seedStore('additional-free');
      await seedMembership(storeId, 'never');

      await expect(
        downgradeService.assertAdditionalEnabled(storeId),
      ).resolves.toBeUndefined();
    });
  });

  // ─── D. 手动录单每日限额 ───────────────────────────────────────────────

  describe('手动录单每日限额（Redis 计数）', () => {
    it('过期门店未达上限时放行并返回已用数量', async () => {
      const { storeId } = await seedStore('manual-ok');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });
      redisStore.clear();

      await downgradeService.incrementManualEntryCount(storeId);
      await downgradeService.incrementManualEntryCount(storeId);

      await expect(downgradeService.assertManualEntryQuota(storeId)).resolves.toBe(2);
    });

    it('达到上限后拦截并带业务码', async () => {
      const { storeId } = await seedStore('manual-limit');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });
      redisStore.clear();

      for (let i = 0; i < MANUAL_ENTRY_DAILY_LIMIT; i += 1) {
        await downgradeService.incrementManualEntryCount(storeId);
      }

      const error = await captureError(() =>
        downgradeService.assertManualEntryQuota(storeId),
      );

      expect(isMembershipExpiredError(error)).toBe(true);
    });

    it('未过期门店不计数、不限额', async () => {
      const { storeId } = await seedStore('manual-active');
      await seedMembership(storeId, 'active', { remainingDays: 50 });
      redisStore.clear();

      await downgradeService.incrementManualEntryCount(storeId);

      await expect(downgradeService.assertManualEntryQuota(storeId)).resolves.toBe(0);
      await expect(downgradeService.getManualEntryUsage(storeId)).resolves.toEqual({
        used: 0,
        limit: MANUAL_ENTRY_DAILY_LIMIT,
      });
    });
  });

  // ─── E. 空间同时开台数 ────────────────────────────────────────────────

  describe('空间同时开台数（真实会话计数）', () => {
    it('过期门店已有 1 个进行中会话 → 阻止开新台', async () => {
      const { storeId } = await seedStore('space-block');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });
      await seedSpaceSession({ storeId, status: 'active' });

      const error = await captureError(() =>
        downgradeService.assertSpaceCanOpen(storeId),
      );

      expect(isMembershipExpiredError(error)).toBe(true);
      const response = (error as ForbiddenException).getResponse() as {
        message?: string;
      };
      expect(response.message).toBe(SPACE_OPEN_BLOCKED_MESSAGE);
    });

    it('过期门店没有进行中会话时允许开第一个台', async () => {
      const { storeId } = await seedStore('space-allow');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });

      await expect(downgradeService.assertSpaceCanOpen(storeId)).resolves.toBeUndefined();
    });

    it('已结算的会话不占用开台额度', async () => {
      const { storeId } = await seedStore('space-settled');
      await seedMembership(storeId, 'expired', { expiredDaysAgo: 1 });
      await seedSpaceSession({ storeId, status: 'settled' });

      await expect(downgradeService.assertSpaceCanOpen(storeId)).resolves.toBeUndefined();
    });

    it('有效会员不受同时开台数限制', async () => {
      const { storeId } = await seedStore('space-active');
      await seedMembership(storeId, 'active', { remainingDays: 60 });
      await seedSpaceSession({ storeId, status: 'active' });

      await expect(downgradeService.assertSpaceCanOpen(storeId)).resolves.toBeUndefined();
    });
  });
});
