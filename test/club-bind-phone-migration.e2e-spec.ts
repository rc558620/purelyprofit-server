import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubAuthService } from '../src/purely-club/auth/club-auth.service';
import { ClubWechatAuthService } from '../src/purely-club/auth/club-wechat-auth.service';
import { AuthProductAuthService } from '../src/shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../src/purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../src/purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { ClubStoreAccessService } from '../src/purely-club/stores/club-store-access.service';
import { ClubPhoneBindService } from '../src/purely-club/auth/club-phone-bind.service';
import { ClubPhoneRebindService } from '../src/purely-club/auth/club-phone-rebind.service';
import { ClubAccountMergeService } from '../src/purely-club/auth/club-account-merge.service';

/**
 * 真实数据库 E2E：微信无手机号用户绑定手机号后的占位值迁移。
 *
 * 为什么必须用真实数据库：
 * 单测只能断言「调用了哪些 updateMany、条件是什么」，
 * 无法证明数据真的被改写、也不会暴露唯一约束冲突。
 * 本用例直接对 members / marketing_customers 做落库与断言。
 *
 * 覆盖的风险（docs/club-scan-ordering/03-scan-first-login-plan.md 的 P0）：
 * 绑定手机号后 JWT 的 phone 会切换为真实手机号，若不同步迁移占位记录，
 * 用户会查不到自己的门店，商家端（purelyProfit）也拿不到真实手机号。
 */
describe('bindPhone 占位手机号迁移 (e2e, real database)', () => {
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
        // 开启 getPhoneNumber 入口，用于验证微信一键绑定链路的真实落库
        case 'auth.wechatPhoneBindEnabled':
          return true;
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
  // 本用例只覆盖 bindPhone，不涉及换绑，因此只需满足构造器注入
  const clubStoreAccessService = {
    invalidateAccessibleStoresCache: jest.fn(),
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ClubAuthService,
        // 批次 2 把绑定逻辑抽到 ClubPhoneBindService 后，本文件的 providers 未同步，
        // 结果整个套件在 compile() 阶段就挂掉（测试一条都没真正跑过）。此处补齐。
        ClubPhoneBindService,
        ClubPhoneRebindService,
        ClubAccountMergeService,
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
      access_token: 'e2e-new-token',
      userId: 0,
    });
  });

  afterAll(async () => {
    // 逆序清理本用例产生的数据，避免污染开发库
    if (createdCustomerIds.length > 0) {
      await prisma.marketingCustomer.deleteMany({
        where: { id: { in: createdCustomerIds } },
      });
    }
    if (createdMemberIds.length > 0) {
      await prisma.member.deleteMany({
        where: { id: { in: createdMemberIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleFixture?.close();
  });

  /** 造一个「微信静默注册产物」：只有 openid、没有手机号 */
  async function createWechatUser(): Promise<{ id: number; openid: string }> {
    const openid = `e2e_openid_${randomUUID().replace(/-/g, '')}`;
    const user = await prisma.user.create({
      data: {
        email: `club_wechat_${openid}@purelyprofit.local`,
        password: 'e2e-placeholder-hash',
        wechatOpenid: openid,
        wechatNickname: 'E2E 微信用户',
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, openid };
  }

  async function requireStoreId(): Promise<number> {
    const store = await prisma.store.findFirst({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!store) throw new Error('e2e 需要数据库中至少存在一个门店');
    return store.id;
  }

  it('绑定手机号后把 club_wechat 占位记录迁移为真实手机号', async () => {
    const storeId = await requireStoreId();
    const { id: userId, openid } = await createWechatUser();
    const placeholderPhone = `club_wechat:${openid}`;
    const realPhone = '13800139901';

    // 模拟「静默注册后扫码入店」：Member / MarketingCustomer 以占位手机号落库
    const member = await prisma.member.create({
      data: { storeId, name: 'E2E 顾客', phone: placeholderPhone },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    const customer = await prisma.marketingCustomer.create({
      data: { storeId, name: 'E2E 顾客', phone: placeholderPhone },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    // 该手机号没有 club 账号 → 走「直接绑定 + 迁移」分支
    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
    authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);

    await service.bindPhone(userId, { phone: realPhone, code: '123456' });

    // 用户表写入真实手机号
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { wechatPhone: true },
    });
    expect(updatedUser?.wechatPhone).toBe(realPhone);

    // Member 占位手机号已迁移 —— 这是「用户不丢门店」的前提
    const updatedMember = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true },
    });
    expect(updatedMember?.phone).toBe(realPhone);

    // MarketingCustomer 占位手机号已迁移，且补上了 clubUserId
    // （后续按 user.id 精确匹配，避免同门店多个无手机号顾客时的回退歧义）
    const updatedCustomer = await prisma.marketingCustomer.findUnique({
      where: { id: customer.id },
      select: { phone: true, clubUserId: true },
    });
    expect(updatedCustomer?.phone).toBe(realPhone);
    expect(updatedCustomer?.clubUserId).toBe(userId);

    // 签发的新 token 必须携带真实手机号，否则下一次请求仍按占位值查门店
    expect(authSessionService.signToken).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ phone: realPhone }),
    );
  });

  it('同门店已绑定该用户时不重复写 clubUserId，避免唯一约束冲突', async () => {
    const storeId = await requireStoreId();
    const { id: userId, openid } = await createWechatUser();
    const placeholderPhone = `club_wechat:${openid}`;
    const realPhone = '13800139902';

    // 另一门店：已绑定该用户（模拟用户此前在别处扫过这家店）
    const otherStore = await prisma.store.findFirst({
      where: { deletedAt: null, id: { not: storeId } },
      select: { id: true },
    });
    const boundStoreId = otherStore?.id ?? storeId;

    const boundCustomer = await prisma.marketingCustomer.create({
      data: {
        storeId: boundStoreId,
        name: 'E2E 已绑定顾客',
        phone: placeholderPhone,
        clubUserId: userId,
      },
      select: { id: true },
    });
    createdCustomerIds.push(boundCustomer.id);

    const pendingCustomer = await prisma.marketingCustomer.create({
      data: {
        storeId,
        name: 'E2E 待绑定顾客',
        phone: placeholderPhone,
      },
      select: { id: true },
    });
    createdCustomerIds.push(pendingCustomer.id);

    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
    authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);

    // 若实现里对「已绑定」门店也写 clubUserId，
    // marketing_customers 的 uq_marketing_customers_store_club_user 会直接抛错
    await expect(
      service.bindPhone(userId, { phone: realPhone, code: '123456' }),
    ).resolves.toEqual(expect.objectContaining({ access_token: 'e2e-new-token' }));

    // 已绑定门店：仅同步 phone，保留原有绑定关系
    const afterBound = await prisma.marketingCustomer.findUnique({
      where: { id: boundCustomer.id },
      select: { phone: true, clubUserId: true },
    });
    expect(afterBound?.phone).toBe(realPhone);
    expect(afterBound?.clubUserId).toBe(userId);

    // 未绑定门店：同步 phone 并补上 clubUserId
    const afterPending = await prisma.marketingCustomer.findUnique({
      where: { id: pendingCustomer.id },
      select: { phone: true, clubUserId: true },
    });
    expect(afterPending?.phone).toBe(realPhone);
    expect(afterPending?.clubUserId).toBe(userId);
  });

  it('账号已绑定手机号时拒绝重复绑定，且不改写任何数据', async () => {
    const storeId = await requireStoreId();
    const { id: userId, openid } = await createWechatUser();
    const placeholderPhone = `club_wechat:${openid}`;

    await prisma.user.update({
      where: { id: userId },
      data: { wechatPhone: '13800139903' },
    });

    const member = await prisma.member.create({
      data: { storeId, name: 'E2E 顾客', phone: placeholderPhone },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
    authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);

    await expect(
      service.bindPhone(userId, { phone: '13800139904', code: '123456' }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 防御性检查在事务之前抛出，占位记录必须原样保留
    const unchanged = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true },
    });
    expect(unchanged?.phone).toBe(placeholderPhone);
  });

  // ─── 微信 getPhoneNumber 一键绑定（批次 3） ────────────────────────────
  //
  // 单测只能断言「调用了哪些 updateMany、条件是什么」。这两条用例直接查库，
  // 证明手机号真的写进去了、以及绑定后再登录不会再被要求绑定。
  it('微信一键绑定：手机号真实落库到 users / members / marketing_customers', async () => {
    const storeId = await requireStoreId();
    const { id: userId, openid } = await createWechatUser();
    const placeholderPhone = `club_wechat:${openid}`;
    const realPhone = '13800139905';

    const member = await prisma.member.create({
      data: { storeId, name: 'E2E 顾客', phone: placeholderPhone },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    const customer = await prisma.marketingCustomer.create({
      data: { storeId, name: 'E2E 顾客', phone: placeholderPhone },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    // 手机号归属由微信背书：这里**没有**短信验证码校验步骤
    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    clubWechatAuthService.getPhoneNumber.mockResolvedValue({
      phoneNumber: `+86${realPhone}`,
      purePhoneNumber: realPhone,
    });

    await service.bindPhoneByWechatCode(userId, { code: 'wx-phone-code' });

    expect(authCodeVerifyService.ensureRegisterCodeValid).not.toHaveBeenCalled();

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { wechatPhone: true },
    });
    expect(updatedUser?.wechatPhone).toBe(realPhone);

    // Member.phone 不迁移 → findAccessibleStores 按 phone 匹配不到 → 用户丢全部门店
    const updatedMember = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true },
    });
    expect(updatedMember?.phone).toBe(realPhone);

    const updatedCustomer = await prisma.marketingCustomer.findUnique({
      where: { id: customer.id },
      select: { phone: true, clubUserId: true },
    });
    expect(updatedCustomer?.phone).toBe(realPhone);
    expect(updatedCustomer?.clubUserId).toBe(userId);

    expect(authSessionService.signToken).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ phone: realPhone }),
    );
  });

  it('绑定成功后再次静默登录：needPhoneBind=false（不再弹出绑定页）', async () => {
    const { id: userId, openid } = await createWechatUser();
    const realPhone = '13800139906';

    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    clubWechatAuthService.getPhoneNumber.mockResolvedValue({
      phoneNumber: `+86${realPhone}`,
      purePhoneNumber: realPhone,
    });

    await service.bindPhoneByWechatCode(userId, { code: 'wx-phone-code' });

    // 二次进入：同一个微信号静默登录（不传 phoneCode）
    clubWechatAuthService.code2session.mockResolvedValue({
      openid,
      unionid: null,
    });
    authProductAuthService.wechatLogin.mockResolvedValue({
      access_token: 'e2e-second-login-token',
      userId,
    });

    const result = await service.wechatLogin({ code: 'wx-login-code' });

    expect(result.needPhoneBind).toBe(false);
    // 未传 phoneCode 时不得再去换取手机号
    expect(clubWechatAuthService.getPhoneNumber).toHaveBeenCalledTimes(1);
  });
});
