import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyCustomerMetrics } from '../src/purely-club/shared/club-customer-metrics.helper';

/**
 * 真实数据库 E2E：顾客消费指标的并发原子性。
 *
 * mock 单测只能证明「生成了一条带 GREATEST 的 UPDATE」，证明不了并发下是否真的
 * 不丢更新——这需要在 Postgres 上真并发跑。这里覆盖三件事：
 * 1. N 个并发事务累加后总额精确等于 N×增量（裸 read-modify-write 会只剩最后一次）；
 * 2. 并发扣款不会把余额扣成负数（条件更新兜底）；
 * 3. 回滚不会把累计消费/次数冲成负数（GREATEST 兜底）。
 */
describe('顾客消费指标原子写 (e2e, real database)', () => {
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

  const tierThresholds = { gold: 1000, diamond: 5000 };

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let storeId = 0;
  let userId = 0;
  let customerId = 0;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    const moduleBuilder = Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
      ],
    });
    moduleFixture = await moduleBuilder.compile();
    prisma = moduleFixture.get(PrismaService);

    const suffix = `${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        email: `e2e-metrics-${suffix}@test.local`,
        password: 'not-used',
      },
    });
    userId = user.id;

    const store = await prisma.store.create({
      data: {
        name: `E2E指标店${suffix}`,
        ownerId: user.id,
        businessMode: 'general',
      },
    });
    storeId = store.id;

    const customer = await prisma.marketingCustomer.create({
      data: { storeId, name: `并发顾客${suffix}` },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.marketingCustomer.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  const resetCustomer = async (data: {
    balance?: number;
    totalSpent?: number;
    visitCount?: number;
    tier?: 'regular' | 'gold' | 'diamond';
    status?: 'active' | 'inactive';
    deletedAt?: Date | null;
  }): Promise<void> => {
    await prisma.marketingCustomer.update({
      where: { id: customerId },
      data: {
        balance: data.balance ?? 0,
        totalSpent: data.totalSpent ?? 0,
        visitCount: data.visitCount ?? 0,
        tier: data.tier ?? 'regular',
        status: data.status ?? 'active',
        deletedAt: data.deletedAt ?? null,
      },
    });
  };

  const readCustomer = () =>
    prisma.marketingCustomer.findUniqueOrThrow({ where: { id: customerId } });

  it('并发 10 次累加不丢更新，并按数据库新值跨档', async () => {
    await resetCustomer({});

    await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) =>
          applyCustomerMetrics(tx, {
            customerId,
            storeId,
            totalSpentDelta: 100,
            visitCountDelta: 1,
            touchLastVisitAt: true,
            tierThresholds,
          }),
        ),
      ),
    );

    const customer = await readCustomer();
    expect(customer.totalSpent).toBe(1000);
    expect(customer.visitCount).toBe(10);
    expect(customer.tier).toBe('gold');
    expect(customer.lastVisitAt).not.toBeNull();
  });

  it('并发扣款不会把余额扣成负数', async () => {
    await resetCustomer({ balance: 1000 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) =>
          applyCustomerMetrics(tx, {
            customerId,
            storeId,
            balanceDelta: -300,
            requireBalanceGte: 300,
            tierThresholds,
          }),
        ),
      ),
    );

    const succeeded = results.filter((row) => row !== null).length;
    const customer = await readCustomer();
    expect(succeeded).toBe(3);
    expect(customer.balance).toBe(100);
    expect(customer.balance).toBeGreaterThanOrEqual(0);
  });

  it('回滚不会把累计消费与到店次数冲成负数', async () => {
    await resetCustomer({ totalSpent: 50, visitCount: 0, balance: 0 });

    const snapshot = await prisma.$transaction((tx) =>
      applyCustomerMetrics(tx, {
        customerId,
        storeId,
        balanceDelta: 200,
        totalSpentDelta: -200,
        visitCountDelta: -1,
        tierThresholds,
      }),
    );

    expect(snapshot?.totalSpent).toBe(0);
    expect(snapshot?.visitCount).toBe(0);
    expect(snapshot?.balance).toBe(200);
    expect(snapshot?.tier).toBe('regular');
  });

  it('requireActive 下停用档案不被更新', async () => {
    await resetCustomer({ balance: 500, status: 'inactive' });

    const snapshot = await prisma.$transaction((tx) =>
      applyCustomerMetrics(tx, {
        customerId,
        storeId,
        balanceDelta: -100,
        requireBalanceGte: 100,
        requireActive: true,
        tierThresholds,
      }),
    );

    expect(snapshot).toBeNull();
    expect((await readCustomer()).balance).toBe(500);
  });

  it('软删档案不被更新', async () => {
    await resetCustomer({ balance: 500, deletedAt: new Date() });

    const snapshot = await prisma.$transaction((tx) =>
      applyCustomerMetrics(tx, {
        customerId,
        storeId,
        balanceDelta: -100,
        requireBalanceGte: 100,
        tierThresholds,
      }),
    );

    expect(snapshot).toBeNull();
    expect((await readCustomer()).balance).toBe(500);
  });
});
