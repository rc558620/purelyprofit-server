import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { NewCustomerQuotaService } from '../src/purely-profit/member/new-customer-quota/new-customer-quota.service';
import { NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE } from '../src/purely-profit/member/new-customer-quota/new-customer-quota.constants';

/**
 * 真实数据库 E2E：并发下「服务的新客数」必须严格等于「扣掉的额度」。
 *
 * 为什么必须用真实库：这是纯并发语义问题，mock 的 prisma 只能断言「调用了什么」，
 * 证明不了 PostgreSQL 行锁 + READ COMMITTED 重新评估 WHERE 真的挡住了第二个新客。
 * 而这条恰恰是「不能多也不能少」的唯一依据——单测覆盖不到，只能靠真库验证。
 */
describe('新客额度并发扣减 (e2e, real database)', () => {
  let prisma: PrismaService;
  let quotaService: NewCustomerQuotaService;
  let moduleFixture: TestingModule;
  let storeId: number;

  /** 用远离真实数据的 id 避开 FK 约束；必须落在 int4 范围内（clubUserId 是 Int） */
  const userA = 2_100_000_001;
  const userB = 2_100_000_002;
  const userC = 2_100_000_003;

  let originalQuota: number | null = null;
  /**
   * 本次运行前该门店最后一条流水的 id。
   * 清理只能删 id 大于它的记录——按 description 删会误伤商家真实的历史流水。
   */
  let logIdWatermark = 0;

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

  /** 把门店额度重置成指定值（测试之间是同一家店，必须显式复位） */
  const resetQuota = async (quota: number): Promise<void> => {
    await prisma.storeMembershipProfile.upsert({
      where: { storeId },
      create: { storeId, newCustomerQuota: quota },
      update: { newCustomerQuota: quota },
    });
  };

  const readQuota = async (): Promise<number> => {
    const profile = await prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { newCustomerQuota: true },
    });
    return profile?.newCustomerQuota ?? 0;
  };

  const cleanConsumeRecords = async (): Promise<void> => {
    await prisma.storeNewCustomerQuotaConsume.deleteMany({
      where: { storeId, clubUserId: { in: [userA, userB, userC] } },
    });
    // 只删本次运行新增的流水，绝不碰商家历史数据
    await prisma.storeNewCustomerQuotaLog.deleteMany({
      where: { storeId, id: { gt: logIdWatermark } },
    });
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        NewCustomerQuotaService,
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    quotaService = moduleFixture.get(NewCustomerQuotaService);

    const store = await prisma.store.findFirst({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!store) throw new Error('e2e 需要数据库中至少存在一个门店');
    storeId = store.id;

    const profile = await prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { newCustomerQuota: true },
    });
    originalQuota = profile?.newCustomerQuota ?? null;

    const latestLog = await prisma.storeNewCustomerQuotaLog.findFirst({
      where: { storeId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    logIdWatermark = latestLog?.id ?? 0;
  });

  beforeEach(async () => {
    await cleanConsumeRecords();
  });

  afterAll(async () => {
    await cleanConsumeRecords();
    if (originalQuota !== null) {
      await prisma.storeMembershipProfile.update({
        where: { storeId },
        data: { newCustomerQuota: originalQuota },
      });
    }
    await moduleFixture?.close();
  });

  it('额度只剩 1 时两个新客并发下单：只成功一个，另一个整笔回滚', async () => {
    await resetQuota(1);

    // 两个事务都先 sleep 再抢额度，确保 UPDATE 行锁真的发生竞争
    const runConsume = (clubUserId: number) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        return quotaService.consumeForNewCustomer(
          storeId,
          clubUserId,
          null,
          tx,
        );
      });

    const results = await Promise.allSettled([
      runConsume(userA),
      runConsume(userB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // 不多：只扣 1 个；不少：另一个必须失败而不是「订单成立但没扣额度」
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(
      (rejection.reason as { response?: { code?: string } }).response?.code,
    ).toBe(NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE);

    // 额度不能变负，也不该多扣
    expect(await readQuota()).toBe(0);
    // 只有成功那笔留下消耗记录
    expect(
      await prisma.storeNewCustomerQuotaConsume.count({
        where: { storeId, clubUserId: { in: [userA, userB] } },
      }),
    ).toBe(1);
  });

  it('额度充足时两个新客并发下单：各扣 1 个，互不干扰', async () => {
    await resetQuota(2);

    const runConsume = (clubUserId: number) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        return quotaService.consumeForNewCustomer(
          storeId,
          clubUserId,
          null,
          tx,
        );
      });

    const results = await Promise.allSettled([
      runConsume(userA),
      runConsume(userB),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await readQuota()).toBe(0);
    expect(
      await prisma.storeNewCustomerQuotaConsume.count({
        where: { storeId, clubUserId: { in: [userA, userB] } },
      }),
    ).toBe(2);
  });

  it('老客重复下单：零写入，额度不再变化', async () => {
    await resetQuota(5);

    const first = await quotaService.consumeForNewCustomer(
      storeId,
      userC,
      null,
    );
    expect(first.consumed).toBe(true);
    expect(await readQuota()).toBe(4);

    // 第二次是老客：必须在写入前被识别出来，不能触发 P2002
    // （PostgreSQL 下事务内 P2002 会让整个事务 aborted，进而拖垮整笔建单）
    const second = await quotaService.consumeForNewCustomer(
      storeId,
      userC,
      null,
    );
    expect(second.consumed).toBe(false);
    expect(await readQuota()).toBe(4);
    expect(
      await prisma.storeNewCustomerQuotaConsume.count({
        where: { storeId, clubUserId: userC },
      }),
    ).toBe(1);
  });

  it('额度为 0 时新客扣减抛业务码，且不留下消耗记录', async () => {
    await resetQuota(0);

    await expect(
      quotaService.consumeForNewCustomer(storeId, userA, null),
    ).rejects.toMatchObject({
      response: { code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE },
    });
    expect(await readQuota()).toBe(0);
    expect(
      await prisma.storeNewCustomerQuotaConsume.count({
        where: { storeId, clubUserId: userA },
      }),
    ).toBe(0);
  });
});
