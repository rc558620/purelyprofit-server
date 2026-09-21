import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubAuthService } from '../src/purely-club/auth/club-auth.service';
import { ClubWechatAuthService } from '../src/purely-club/auth/club-wechat-auth.service';
import { AuthProductAuthService } from '../src/shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../src/purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../src/purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { ClubStoreAccessService } from '../src/purely-club/stores/club-store-access.service';

/**
 * 真实数据库 E2E：**先绑手机号、后触发合并** 时会员档案必须跟着走。
 *
 * 这是 03 文档第 6 节那个 P0 的核心场景：
 * `mergeWechatUserToPhoneUser` 曾经只按 `phone = club_wechat:{openid}` 找源用户档案。
 * 一旦用户已经先绑过一个手机号（那时占位值已被迁成真实号码），这条查询**一条都找不到**——
 * openid 合到目标账号了，而 Member / MarketingCustomer（储值余额、积分、消费记录）
 * 全留在源账号上，用户在新账号里看不到自己的资产。
 *
 * 为什么必须用真实库：单测只能断言「调用了什么」，证明不了数据真的被改写，
 * 也暴露不了 `uq_marketing_customers_store_club_user` 部分唯一索引冲突。
 */
describe('先绑号后合并：会员档案迁移 (e2e, real database)', () => {
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
      access_token: 'e2e-merged-token',
      userId: 0,
    });
    authSessionService.bumpTokenVersion.mockResolvedValue(undefined);
    authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
    authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
  });

  afterAll(async () => {
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

  async function requireStoreId(): Promise<number> {
    const store = await prisma.store.findFirst({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!store) throw new Error('e2e 需要数据库中至少存在一个门店');
    return store.id;
  }

  /** 源账号：微信静默注册，只有 openid */
  async function createWechatUser(): Promise<{ id: number; openid: string }> {
    const openid = `e2e_merge_openid_${randomUUID().replace(/-/g, '')}`;
    const user = await prisma.user.create({
      data: {
        email: `club_wechat_${openid}@purelyprofit.local`,
        password: 'e2e-placeholder-hash',
        wechatOpenid: openid,
        wechatNickname: 'E2E 源用户',
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, openid };
  }

  /** 目标账号：手机号注册，未绑微信（合并的落点） */
  async function createPhoneUser(phone: string): Promise<number> {
    const user = await prisma.user.create({
      data: {
        email: `club_phone_${phone}@purelyprofit.local`,
        password: 'e2e-placeholder-hash',
        wechatPhone: phone,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /** 让 findUserByPhone 指向目标账号，从而走合并分支 */
  const mockTargetUser = (targetUserId: number, phone: string): void => {
    authAccountLookupService.findUserByPhone.mockResolvedValue({
      id: targetUserId,
      email: `club_phone_${phone}@purelyprofit.local`,
      password: 'e2e-placeholder-hash',
      phone,
      accountScope: 'purely_club',
    });
  };

  it('先绑一个手机号、再绑到已有账号触发合并：已迁到真实手机号的 Member 必须跟着迁走', async () => {
    const storeId = await requireStoreId();
    const { id: sourceUserId, openid } = await createWechatUser();
    const placeholderPhone = `club_wechat:${openid}`;
    const firstPhone = '13800139911';
    const secondPhone = '13800139912';

    // 模拟「静默注册后扫码入店」：档案以占位手机号落库
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

    // ① 先绑一个没有归属账号的手机号 → 占位值被迁成 firstPhone
    authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    await service.bindPhone(sourceUserId, {
      phone: firstPhone,
      code: '123456',
    });

    const afterFirstBind = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true },
    });
    expect(afterFirstBind?.phone).toBe(firstPhone);

    // ② 再绑一个属于「已有手机号账号」的号码 → 触发合并。
    //    此时源 Member 的 phone 已是 firstPhone（不再是占位值）。
    const targetUserId = await createPhoneUser(secondPhone);
    mockTargetUser(targetUserId, secondPhone);

    await service.bindPhone(sourceUserId, {
      phone: secondPhone,
      code: '123456',
    });

    // openid 已合到目标账号
    const mergedTarget = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { wechatOpenid: true },
    });
    expect(mergedTarget?.wechatOpenid).toBe(openid);

    // 会员档案必须跟着走 —— 旧实现在这里会漏掉（Member.phone 停在 firstPhone）
    const afterMerge = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true },
    });
    expect(afterMerge?.phone).toBe(secondPhone);

    // 营销顾客档案同样改绑到目标账号
    const mergedCustomer = await prisma.marketingCustomer.findUnique({
      where: { id: customer.id },
      select: { phone: true, clubUserId: true },
    });
    expect(mergedCustomer?.phone).toBe(secondPhone);
    expect(mergedCustomer?.clubUserId).toBe(targetUserId);
  });

  it('合并后储值余额与积分在新账号名下可见（不随源账号一起丢）', async () => {
    const storeId = await requireStoreId();
    const { id: sourceUserId, openid } = await createWechatUser();
    const targetPhone = '13800139913';
    const targetUserId = await createPhoneUser(targetPhone);

    const customer = await prisma.marketingCustomer.create({
      data: {
        storeId,
        name: 'E2E 有余额顾客',
        phone: `club_wechat:${openid}`,
        clubUserId: sourceUserId,
        balance: 645070,
        points: 30,
        totalSpent: 9000,
        visitCount: 2,
      },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);

    const member = await prisma.member.create({
      data: {
        storeId,
        name: 'E2E 有余额顾客',
        phone: `club_wechat:${openid}`,
        beanBalance: 7,
      },
      select: { id: true },
    });
    createdMemberIds.push(member.id);

    mockTargetUser(targetUserId, targetPhone);
    await service.bindPhone(sourceUserId, {
      phone: targetPhone,
      code: '123456',
    });

    // 按目标账号查得到该顾客（用户在新账号里能看到自己的资产）
    const visible = await prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId: targetUserId },
      select: { id: true, balance: true, points: true },
    });
    expect(visible?.id).toBe(customer.id);
    expect(visible?.balance).toBe(645070);
    expect(visible?.points).toBe(30);

    const mergedMember = await prisma.member.findUnique({
      where: { id: member.id },
      select: { phone: true, beanBalance: true },
    });
    expect(mergedMember?.phone).toBe(targetPhone);
    expect(mergedMember?.beanBalance).toBe(7);
  });

  it('同门店双方都有档案时资产并入目标、源档案软删除，且不触发唯一约束冲突', async () => {
    const storeId = await requireStoreId();
    const { id: sourceUserId, openid } = await createWechatUser();
    const targetPhone = '13800139914';
    const targetUserId = await createPhoneUser(targetPhone);

    const sourceCustomer = await prisma.marketingCustomer.create({
      data: {
        storeId,
        name: 'E2E 源顾客',
        phone: `club_wechat:${openid}`,
        clubUserId: sourceUserId,
        balance: 1000,
        points: 5,
      },
      select: { id: true },
    });
    createdCustomerIds.push(sourceCustomer.id);

    const targetCustomer = await prisma.marketingCustomer.create({
      data: {
        storeId,
        name: 'E2E 目标顾客',
        phone: targetPhone,
        clubUserId: targetUserId,
        balance: 2000,
        points: 10,
      },
      select: { id: true },
    });
    createdCustomerIds.push(targetCustomer.id);

    const sourceMember = await prisma.member.create({
      data: {
        storeId,
        name: 'E2E 源顾客',
        phone: `club_wechat:${openid}`,
        beanBalance: 7,
      },
      select: { id: true },
    });
    createdMemberIds.push(sourceMember.id);

    const targetMember = await prisma.member.create({
      data: { storeId, name: 'E2E 目标顾客', phone: targetPhone, beanBalance: 3 },
      select: { id: true },
    });
    createdMemberIds.push(targetMember.id);

    mockTargetUser(targetUserId, targetPhone);

    // 若实现直接把源顾客的 clubUserId 改成目标，
    // uq_marketing_customers_store_club_user 会立刻抛冲突
    await expect(
      service.bindPhone(sourceUserId, { phone: targetPhone, code: '123456' }),
    ).resolves.toEqual(
      expect.objectContaining({ access_token: 'e2e-merged-token' }),
    );

    // 资产并入目标档案
    const merged = await prisma.marketingCustomer.findUnique({
      where: { id: targetCustomer.id },
      select: { balance: true, points: true },
    });
    expect(merged?.balance).toBe(3000);
    expect(merged?.points).toBe(15);

    // 源档案软删除且清空 phone（硬删会被必填外键流水挡下）
    const disposed = await prisma.marketingCustomer.findUnique({
      where: { id: sourceCustomer.id },
      select: { deletedAt: true, phone: true, clubUserId: true },
    });
    expect(disposed?.deletedAt).not.toBeNull();
    expect(disposed?.phone).toBeNull();
    expect(disposed?.clubUserId).toBeNull();

    // 纯利豆结转，源 Member 软删除并清空 phone
    const mergedTargetMember = await prisma.member.findUnique({
      where: { id: targetMember.id },
      select: { beanBalance: true },
    });
    expect(mergedTargetMember?.beanBalance).toBe(10);

    const disposedMember = await prisma.member.findUnique({
      where: { id: sourceMember.id },
      select: { deletedAt: true, phone: true },
    });
    expect(disposedMember?.deletedAt).not.toBeNull();
    expect(disposedMember?.phone).toBeNull();
  });
});
