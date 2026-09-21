import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubAuthService } from '../src/purely-club/auth/club-auth.service';
import { ClubWechatAuthService } from '../src/purely-club/auth/club-wechat-auth.service';
import { ClubStoreAccessService } from '../src/purely-club/stores/club-store-access.service';
import { AuthProductAuthService } from '../src/shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../src/purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../src/purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';

/**
 * 真实数据库 E2E：换绑手机号后的档案同步。
 *
 * 为什么必须用真实数据库：
 * 单测只能断言「调用了哪些 updateMany、条件是什么」——**条件本身可能写错**。
 * 本用例的由来就是一次真实事故：换绑按 `Member.customerId` 定位档案，而
 * `members.customer_id` 在现存数据里**全为 null**（该列是「可选、兼容历史数据」），
 * 于是更新命中 0 条，`Member.phone` 留在旧号 →
 * `findAccessibleStores` 按新号匹配不到门店 → **用户当场失去全部门店访问权**。
 * 当时的单测断言了错误的 WHERE 子句，所以一路绿灯。
 *
 * 因此本用例刻意**按线上真实形态造数**：`Member.customer_id` 保持 null。
 */
describe('rebindPhone 档案同步 (e2e, real database)', () => {
  let prisma: PrismaService;
  let service: ClubAuthService;
  let moduleFixture: TestingModule;

  const createdUserIds: number[] = [];
  const createdMemberIds: number[] = [];
  const createdCustomerIds: number[] = [];

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

  const clubWechatAuthService = {
    code2session: jest.fn(),
    getPhoneNumber: jest.fn(),
  };
  const authProductAuthService = {
    wechatLogin: jest.fn(),
    sendClubLoginOrRegisterCode: jest.fn(),
    sendBindPhoneCode: jest.fn(),
    loginByCodeOrRegister: jest.fn(),
  };
  const authCodeVerifyService = {
    ensureRegisterCodeValid: jest.fn(),
    clearRegisterCode: jest.fn(),
  };
  const authAccountLookupService = { findUserByPhone: jest.fn() };
  const authSessionService = {
    signToken: jest.fn(),
    bumpTokenVersion: jest.fn(),
  };
  // 契约本身就是「换绑后必须清缓存」，因此这里用真的 spy 断言，
  // 不接真实 Redis（e2e 只验证数据库侧结果）
  const clubStoreAccessService = {
    invalidateAccessibleStoresCache: jest.fn(),
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ClubAuthService,
        { provide: ClubWechatAuthService, useValue: clubWechatAuthService },
        { provide: AuthProductAuthService, useValue: authProductAuthService },
        { provide: AuthCodeVerifyService, useValue: authCodeVerifyService },
        {
          provide: AuthAccountLookupService,
          useValue: authAccountLookupService,
        },
        { provide: AuthSessionService, useValue: authSessionService },
        {
          provide: ClubStoreAccessService,
          useValue: clubStoreAccessService,
        },
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    service = moduleFixture.get(ClubAuthService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authSessionService.signToken.mockResolvedValue({
      access_token: 'e2e-rebind-token',
      userId: 0,
    });
    authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
    authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
    // 新号不属于任何账号 → 走「直接改号」分支
    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
  });

  afterAll(async () => {
    // 逆序清理本用例产生的数据，避免污染开发库
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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleFixture?.close();
  });

  async function requireStoreIds(count: number): Promise<number[]> {
    const stores = await prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      take: count,
      select: { id: true },
    });
    if (stores.length < count) {
      throw new Error(`e2e 需要数据库中至少存在 ${count} 个门店`);
    }
    return stores.map((store) => store.id);
  }

  /** 造一个已绑手机号的 club 用户 */
  async function createBoundUser(phone: string): Promise<number> {
    const openid = `e2e_rebind_${randomUUID().replace(/-/g, '')}`;
    const user = await prisma.user.create({
      data: {
        email: `club_wechat_${openid}@purelyprofit.local`,
        password: 'e2e-placeholder-hash',
        wechatOpenid: openid,
        wechatPhone: phone,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /**
   * 造该用户在指定门店的档案。
   *
   * `Member.customerId` **刻意不写**——线上现存数据全为 null，
   * 换绑若按 customerId 定位就会漏掉这些记录（本用例要覆盖的正是这一点）。
   */
  async function createProfiles(
    userId: number,
    storeId: number,
    phone: string,
    name: string,
  ): Promise<{ memberId: number; customerId: number }> {
    const member = await prisma.member.create({
      data: { storeId, name, phone },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    const customer = await prisma.marketingCustomer.create({
      data: { storeId, clubUserId: userId, name, phone },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    return { memberId: member.id, customerId: customer.id };
  }

  it('换绑后 Member.phone 必须同步 —— 否则用户当场失去全部门店访问权', async () => {
    const [storeId] = await requireStoreIds(1);
    const previousPhone = '13800139911';
    const nextPhone = '13800139910';
    const userId = await createBoundUser(previousPhone);
    const { memberId, customerId } = await createProfiles(
      userId,
      storeId,
      previousPhone,
      '纯利会员9911',
    );

    await expect(
      service.rebindPhone(userId, { phone: nextPhone, code: '123456' }),
    ).resolves.toEqual(expect.objectContaining({ access_token: 'e2e-rebind-token' }));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { wechatPhone: true, phoneRebindAt: true },
    });
    expect(user?.wechatPhone).toBe(nextPhone);
    expect(user?.phoneRebindAt).not.toBeNull();

    // —— 本次事故的核心断言 ——
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: { phone: true, name: true },
    });
    expect(member?.phone).toBe(nextPhone);

    const customer = await prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { phone: true, name: true },
    });
    expect(customer?.phone).toBe(nextPhone);

    // 展示名同步：否则商家端一直显示旧号后 4 位（「纯利会员9911」）
    expect(member?.name).toBe('纯利会员9910');
    expect(customer?.name).toBe('纯利会员9910');

    // 端到端结论：按新号必须能查回该门店
    // （这一条就是 findAccessibleStores 的真实查询形态）
    const accessibleStores = await prisma.store.findMany({
      where: {
        deletedAt: null,
        members: { some: { phone: nextPhone, status: { not: 'banned' } } },
      },
      select: { id: true },
    });
    expect(accessibleStores.map((store) => store.id)).toContain(storeId);
  });

  it('多门店：该用户在所有门店的档案都要同步', async () => {
    const [firstStoreId, secondStoreId] = await requireStoreIds(2);
    const previousPhone = '13800139921';
    const nextPhone = '13800139920';
    const userId = await createBoundUser(previousPhone);

    const first = await createProfiles(
      userId,
      firstStoreId,
      previousPhone,
      '纯利会员9921',
    );
    const second = await createProfiles(
      userId,
      secondStoreId,
      previousPhone,
      '纯利会员9921',
    );

    await service.rebindPhone(userId, { phone: nextPhone, code: '123456' });

    const members = await prisma.member.findMany({
      where: { id: { in: [first.memberId, second.memberId] } },
      select: { phone: true },
    });
    expect(members).toHaveLength(2);
    for (const item of members) {
      expect(item.phone).toBe(nextPhone);
    }

    const customers = await prisma.marketingCustomer.findMany({
      where: { id: { in: [first.customerId, second.customerId] } },
      select: { phone: true },
    });
    expect(customers).toHaveLength(2);
    for (const item of customers) {
      expect(item.phone).toBe(nextPhone);
    }
  });

  it('同一门店内其他用户的档案不受影响（不跨用户串改）', async () => {
    const [storeId] = await requireStoreIds(1);
    const previousPhone = '13800139931';
    const nextPhone = '13800139930';
    const userId = await createBoundUser(previousPhone);

    // 目标用户
    const target = await createProfiles(
      userId,
      storeId,
      previousPhone,
      '纯利会员9931',
    );
    // 同门店另一个用户（号码不同，绝不能被改）
    const otherUserId = await createBoundUser('13800139999');
    const other = await createProfiles(
      otherUserId,
      storeId,
      '13800139999',
      '纯利会员9999',
    );

    await service.rebindPhone(userId, { phone: nextPhone, code: '123456' });

    const untouchedMember = await prisma.member.findUnique({
      where: { id: other.memberId },
      select: { phone: true, name: true },
    });
    expect(untouchedMember?.phone).toBe('13800139999');
    expect(untouchedMember?.name).toBe('纯利会员9999');

    const untouchedCustomer = await prisma.marketingCustomer.findUnique({
      where: { id: other.customerId },
      select: { phone: true },
    });
    expect(untouchedCustomer?.phone).toBe('13800139999');

    const reboundMember = await prisma.member.findUnique({
      where: { id: target.memberId },
      select: { phone: true },
    });
    expect(reboundMember?.phone).toBe(nextPhone);
  });

  it('换绑后清「可访问门店」缓存', async () => {
    const [storeId] = await requireStoreIds(1);
    const userId = await createBoundUser('13800139941');
    await createProfiles(userId, storeId, '13800139941', '纯利会员9941');

    await service.rebindPhone(userId, { phone: '13800139940', code: '123456' });

    expect(
      clubStoreAccessService.invalidateAccessibleStoresCache,
    ).toHaveBeenCalledWith(userId);
  });
});
