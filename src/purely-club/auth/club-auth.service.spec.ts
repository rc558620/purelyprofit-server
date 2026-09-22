import {
  BadRequestException,
  ConflictException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { PhoneUserRecord } from '../../shared/auth/auth-account.types';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubAccountMergeService } from './club-account-merge.service';
import { ClubAuthService } from './club-auth.service';
import { ClubPhoneBindService } from './club-phone-bind.service';
import { ClubPhoneRebindService } from './club-phone-rebind.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

describe('ClubAuthService', () => {
  let service: ClubAuthService;
  let authProductAuthService: jest.Mocked<AuthProductAuthService>;
  let clubWechatAuthService: jest.Mocked<ClubWechatAuthService>;
  let authCodeVerifyService: jest.Mocked<AuthCodeVerifyService>;
  let authAccountLookupService: jest.Mocked<AuthAccountLookupService>;
  let authSessionService: jest.Mocked<AuthSessionService>;
  let clubStoreAccessService: jest.Mocked<ClubStoreAccessService>;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    member: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    marketingCustomer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    store: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const authProductAuthServiceMock = {
    sendClubLoginOrRegisterCode: jest.fn(),
    sendBindPhoneCode: jest.fn(),
    loginByCodeOrRegister: jest.fn(),
    wechatLogin: jest.fn(),
  };

  const clubWechatAuthServiceMock = {
    code2session: jest.fn(),
    getPhoneNumber: jest.fn(),
  };

  const authCodeVerifyServiceMock = {
    ensureRegisterCodeValid: jest.fn(),
    clearRegisterCode: jest.fn(),
  };

  const authAccountLookupServiceMock = {
    findUserByPhone: jest.fn(),
  };

  const authSessionServiceMock = {
    signToken: jest.fn(),
    bumpTokenVersion: jest.fn(),
  };

  const clubStoreAccessServiceMock = {
    invalidateAccessibleStoresCache: jest.fn(),
  };

  /**
   * 配置开关：auth.wechatPhoneBindEnabled 控制 getPhoneNumber 入口是否开放。
   * 默认 true（开放），个别用例会改成 false 验证门禁。
   */
  const configServiceMock = {
    get: jest.fn((key: string): unknown =>
      key === 'auth.wechatPhoneBindEnabled' ? true : undefined,
    ),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubAuthService,
        // 手机号首次绑定 / 换绑已抽离为专职服务，这里用真实实现 + 共享 mock 依赖，
        // 以保证用例仍验证的是同一条端到端链路。
        ClubPhoneBindService,
        ClubPhoneRebindService,
        ClubAccountMergeService,
        {
          provide: AuthProductAuthService,
          useValue: authProductAuthServiceMock,
        },
        { provide: ClubWechatAuthService, useValue: clubWechatAuthServiceMock },
        { provide: PrismaService, useValue: prismaService },
        { provide: AuthCodeVerifyService, useValue: authCodeVerifyServiceMock },
        {
          provide: AuthAccountLookupService,
          useValue: authAccountLookupServiceMock,
        },
        { provide: AuthSessionService, useValue: authSessionServiceMock },
        {
          provide: ClubStoreAccessService,
          useValue: clubStoreAccessServiceMock,
        },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<ClubAuthService>(ClubAuthService);
    authProductAuthService = module.get(
      AuthProductAuthService,
    ) as jest.Mocked<AuthProductAuthService>;
    clubWechatAuthService = module.get(
      ClubWechatAuthService,
    ) as jest.Mocked<ClubWechatAuthService>;
    authCodeVerifyService = module.get(
      AuthCodeVerifyService,
    ) as jest.Mocked<AuthCodeVerifyService>;
    authAccountLookupService = module.get(
      AuthAccountLookupService,
    ) as jest.Mocked<AuthAccountLookupService>;
    authSessionService = module.get(
      AuthSessionService,
    ) as jest.Mocked<AuthSessionService>;
    clubStoreAccessService = module.get(
      ClubStoreAccessService,
    ) as jest.Mocked<ClubStoreAccessService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // 事务直接回调同一 mock 对象，模拟真实事务执行
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
  });

  describe('wechatLogin', () => {
    it('首次微信登录（仅传 code）：自动注册并返回 needPhoneBind=true', async () => {
      clubWechatAuthService.code2session.mockResolvedValue({
        openid: 'openid_abc',
        sessionKey: 'sk_1',
      });
      authProductAuthService.wechatLogin.mockResolvedValue({
        access_token: 'token_x',
        userId: 42,
      });
      prismaService.user.findUnique.mockResolvedValue({ wechatPhone: null });

      const result = await service.wechatLogin({ code: 'code_1' });

      expect(clubWechatAuthService.code2session).toHaveBeenCalledWith('code_1');
      expect(authProductAuthService.wechatLogin).toHaveBeenCalledWith(
        {
          openid: 'openid_abc',
          unionid: undefined,
          nickname: undefined,
          avatar: undefined,
          phone: undefined,
        },
        'purely_club',
      );
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: { wechatPhone: true },
      });
      expect(result).toEqual({
        access_token: 'token_x',
        userId: 42,
        needPhoneBind: true,
      });
    });

    it('已绑定手机号的账号再次微信登录：needPhoneBind=false', async () => {
      clubWechatAuthService.code2session.mockResolvedValue({
        openid: 'openid_abc',
        sessionKey: 'sk_1',
      });
      authProductAuthService.wechatLogin.mockResolvedValue({
        access_token: 'token_x',
        userId: 42,
      });
      prismaService.user.findUnique.mockResolvedValue({
        wechatPhone: '13800138000',
      });

      const result = await service.wechatLogin({ code: 'code_1' });

      expect(result.needPhoneBind).toBe(false);
    });

    it('传入 phoneCode 时解密手机号并透传给登录服务', async () => {
      clubWechatAuthService.code2session.mockResolvedValue({
        openid: 'openid_abc',
        sessionKey: 'sk_1',
      });
      clubWechatAuthService.getPhoneNumber.mockResolvedValue({
        phoneNumber: '+8613800138000',
        purePhoneNumber: '13800138000',
      });
      authProductAuthService.wechatLogin.mockResolvedValue({
        access_token: 'token_x',
        userId: 42,
      });
      prismaService.user.findUnique.mockResolvedValue({ wechatPhone: null });

      await service.wechatLogin({
        code: 'code_1',
        phoneCode: 'phone_code_1',
      });

      expect(clubWechatAuthService.getPhoneNumber).toHaveBeenCalledWith(
        'phone_code_1',
      );
      expect(authProductAuthService.wechatLogin).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '13800138000' }),
        'purely_club',
      );
    });
  });

  describe('bindPhone', () => {
    const currentUserBase = {
      id: 42,
      email: 'club_wechat_openid_abc@purelyprofit.local',
      wechatOpenid: 'openid_abc',
      wechatUnionid: null,
      wechatNickname: '微信昵称',
      wechatAvatar: null,
      wechatPhone: null,
    };

    it('手机号无账号：直接绑定并签发新 token', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique.mockResolvedValue(currentUserBase);
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'new_token',
        userId: 42,
      });
      prismaService.member.updateMany.mockResolvedValue({ count: 0 });
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.bindPhone(42, {
        phone: '13800138000',
        code: '123456',
      });

      expect(
        authCodeVerifyService.ensureRegisterCodeValid,
      ).toHaveBeenCalledWith('13800138000', '123456', 'purely_club');
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { wechatPhone: '13800138000' },
      });
      expect(authSessionService.signToken).toHaveBeenCalledWith(42, {
        phone: '13800138000',
        email: currentUserBase.email,
        accountScope: 'purely_club',
      });
      expect(result).toEqual({ access_token: 'new_token', userId: 42 });
    });

    it('手机号无账号：把 club_wechat 占位手机号迁移为真实手机号', async () => {
      // 回归防护：绑定手机号后 JWT 的 phone 会切换为真实手机号，
      // 若不同步迁移 Member / MarketingCustomer 的占位值，
      // 用户将查不到自己的门店，商家端也拿不到真实手机号。
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique.mockResolvedValue(currentUserBase);
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'new_token',
        userId: 42,
      });
      prismaService.member.updateMany.mockResolvedValue({ count: 2 });
      // 门店 18 已绑定该用户 → 只能同步 phone，不能再写 clubUserId
      prismaService.marketingCustomer.findMany.mockResolvedValue([
        { storeId: 18 },
      ]);
      prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 1 });

      await service.bindPhone(42, { phone: '13800138000', code: '123456' });

      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { phone: 'club_wechat:openid_abc' },
        data: { phone: '13800138000' },
      });

      // 未绑定该用户的门店：同步 phone 并补上 clubUserId
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: {
          phone: 'club_wechat:openid_abc',
          storeId: { notIn: [18] },
        },
        data: { phone: '13800138000', clubUserId: 42 },
      });

      // 已绑定该用户的门店：仅同步 phone，避免触发部分唯一索引冲突
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { phone: 'club_wechat:openid_abc', storeId: { in: [18] } },
        data: { phone: '13800138000' },
      });

      // 扫码点餐链路用 resolveActiveCustomer 建档时 phone 会落成 null，
      // 这类记录匹配不到占位值，必须按 clubUserId 兜底补齐，否则商家端查不到该顾客
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: {
          clubUserId: 42,
          phone: null,
          storeId: { notIn: [18] },
        },
        data: { phone: '13800138000' },
      });

      // 自动生成的展示名取自 openid 后 4 位，对商家没有意义，绑定后需重新生成
      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { phone: '13800138000', name: '纯利会员_abc' },
        data: { name: '纯利会员8000' },
      });
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { phone: '13800138000', name: '纯利会员_abc' },
        data: { name: '纯利会员8000' },
      });
    });

    it('当前账号已绑定手机号：拒绝重复绑定，不覆盖 wechatPhone', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      prismaService.user.findUnique.mockResolvedValue({
        ...currentUserBase,
        wechatPhone: '13800138000',
      });
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);

      await expect(
        service.bindPhone(42, { phone: '13800138001', code: '123456' }),
      ).rejects.toThrow(ConflictException);
      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('目标账号已绑定其他微信 openid：拒绝合并，避免覆盖 openid', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      prismaService.user.findUnique
        .mockResolvedValueOnce(currentUserBase)
        .mockResolvedValueOnce({ wechatOpenid: 'openid_other' });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });

      await expect(
        service.bindPhone(42, { phone: '13800138000', code: '123456' }),
      ).rejects.toThrow('该手机号已绑定其他微信账号');
      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(authSessionService.signToken).not.toHaveBeenCalled();
    });

    it('手机号已有账号且未绑定微信：事务合并成功后签发新 token', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique
        .mockResolvedValueOnce(currentUserBase) // 当前用户
        .mockResolvedValueOnce({ wechatOpenid: null }) // 目标账号 openid 检查
        .mockResolvedValueOnce({
          // 合并后查询目标账号 email
          email: 'club_phone_13800138000@purelyprofit.local',
        });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });
      // 源用户无 Member、无营销顾客、无门店
      prismaService.member.findMany.mockResolvedValue([]);
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.store.findMany.mockResolvedValue([]);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'merged_token',
        userId: 99,
      });

      const result = await service.bindPhone(42, {
        phone: '13800138000',
        code: '123456',
      });

      // 事务内清空源用户微信字段 + 将 openid 绑定到目标用户
      expect(prismaService.user.update).toHaveBeenCalledTimes(2);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: {
          wechatOpenid: null,
          wechatUnionid: null,
          wechatNickname: null,
          wechatAvatar: null,
          wechatPhone: null,
        },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: {
          wechatOpenid: 'openid_abc',
          wechatNickname: '微信昵称',
          wechatPhone: '13800138000',
        },
      });
      // 两端旧登录态失效
      expect(authSessionService.bumpTokenVersion).toHaveBeenCalledWith(42);
      expect(authSessionService.bumpTokenVersion).toHaveBeenCalledWith(99);
      expect(authSessionService.signToken).toHaveBeenCalledWith(99, {
        phone: '13800138000',
        email: 'club_phone_13800138000@purelyprofit.local',
        accountScope: 'purely_club',
      });
      expect(result).toEqual({ access_token: 'merged_token', userId: 99 });
    });

    it('合并时源用户有 Member 记录：迁移到目标用户手机号', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(
        undefined,
      );
      prismaService.user.findUnique
        .mockResolvedValueOnce(currentUserBase)
        .mockResolvedValueOnce({ wechatOpenid: null })
        .mockResolvedValueOnce({
          email: 'club_phone_13800138000@purelyprofit.local',
        });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });
      // 源用户有 1 个 Member，目标用户在该门店无 Member → 更新 phone
      // （resolveSourceMembership 先按占位值查一次，再查同门店的目标 Member）
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.member.findMany
        .mockResolvedValueOnce([{ id: 1, storeId: 5, beanBalance: 0 }])
        .mockResolvedValueOnce([]);
      prismaService.store.findMany.mockResolvedValue([]);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'merged_token',
        userId: 99,
      });

      await service.bindPhone(42, { phone: '13800138000', code: '123456' });

      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { phone: '13800138000' },
      });
      expect(prismaService.member.deleteMany).not.toHaveBeenCalled();
    });

    // ─── P0：源用户已先绑过手机号时，合并不能漏迁会员档案 ───────────────────
    //
    // 场景：源用户先绑了手机号 A（那时 migrateWechatPlaceholderPhone 已把
    // Member.phone 从 club_wechat:{openid} 迁成 A），之后又绑了属于目标账号的
    // 手机号 B 触发合并。旧实现只按占位值查 Member → 一条都查不到 →
    // openid 合过去了、会员档案与资产全留在源账号上。
    it('P0：源用户 Member 已迁到真实手机号（先绑号后合并）时仍被定位并迁移', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique
        .mockResolvedValueOnce({
          ...currentUserBase,
          wechatPhone: '15919654011',
        })
        .mockResolvedValueOnce({ wechatOpenid: null })
        .mockResolvedValueOnce({
          email: 'club_phone_13800138000@purelyprofit.local',
        });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });

      // 按查询条件而非调用顺序返回结果：顺序耦合会让「实现换了但用例照样绿」
      prismaService.marketingCustomer.findMany.mockImplementation(
        async (args: { where?: { clubUserId?: number } }) =>
          args?.where?.clubUserId === 42
            ? [{ id: 10, storeId: 5, balance: 0, points: 0, totalSpent: 0, visitCount: 0 }]
            : [],
      );

      prismaService.member.findMany.mockImplementation(
        async (args: { where?: { phone?: unknown } }) => {
          const phone = args?.where?.phone;
          // 「门店范围 + 候选手机号」定位：已迁到真实号码的档案只能这样找到
          if (phone && typeof phone === 'object' && 'in' in phone) {
            return [{ id: 1, storeId: 5, beanBalance: 0 }];
          }
          // 按占位值查、按目标手机号查：都查不到
          return [];
        },
      );
      prismaService.store.findMany.mockResolvedValue([]);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'merged_token',
        userId: 99,
      });

      await service.bindPhone(42, { phone: '13800138000', code: '123456' });

      // 定位必须覆盖「源用户已绑的真实手机号」，不能只认占位值
      expect(prismaService.member.findMany).toHaveBeenCalledWith({
        where: {
          storeId: { in: [5] },
          phone: { in: ['club_wechat:openid_abc', '15919654011'] },
        },
        select: { id: true, storeId: true, beanBalance: true },
      });
      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { phone: '13800138000' },
      });
    });

    it('P0：营销顾客档案也要跟着改绑 clubUserId 并同步手机号', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique
        .mockResolvedValueOnce(currentUserBase)
        .mockResolvedValueOnce({ wechatOpenid: null })
        .mockResolvedValueOnce({
          email: 'club_phone_13800138000@purelyprofit.local',
        });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });

      prismaService.marketingCustomer.findMany.mockImplementation(
        async (args: { where?: { clubUserId?: number } }) =>
          args?.where?.clubUserId === 42
            ? [{ id: 10, storeId: 5, balance: 645070, points: 0, totalSpent: 0, visitCount: 0 }]
            : [], // 目标在该门店无档案 → 走改绑
      );
      prismaService.member.findMany.mockResolvedValue([]);
      prismaService.store.findMany.mockResolvedValue([]);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'merged_token',
        userId: 99,
      });

      await service.bindPhone(42, { phone: '13800138000', code: '123456' });

      // 储值余额 / 积分 / 消费记录都挂在 MarketingCustomer 上，改绑后用户才看得到
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [10] } },
        data: { clubUserId: 99, phone: '13800138000' },
      });
    });

    it('P0：同门店双方都有档案时资产并入目标，源档案软删除且清空 phone（不硬删）', async () => {
      authCodeVerifyService.ensureRegisterCodeValid.mockResolvedValue(undefined);
      authCodeVerifyService.clearRegisterCode.mockResolvedValue(undefined);
      prismaService.user.findUnique
        .mockResolvedValueOnce(currentUserBase)
        .mockResolvedValueOnce({ wechatOpenid: null })
        .mockResolvedValueOnce({
          email: 'club_phone_13800138000@purelyprofit.local',
        });
      authAccountLookupService.findUserByPhone.mockResolvedValue({
        id: 99,
        email: 'club_phone_13800138000@purelyprofit.local',
        password: 'hash',
        phone: '13800138000',
        accountScope: 'purely_club',
      });

      prismaService.marketingCustomer.findMany.mockImplementation(
        async (args: { where?: { clubUserId?: number } }) => {
          if (args?.where?.clubUserId === 42) {
            return [
              {
                id: 10,
                storeId: 5,
                balance: 645070,
                points: 30,
                totalSpent: 9000,
                visitCount: 2,
              },
            ];
          }
          return [{ id: 20, storeId: 5 }]; // 目标已有档案
        },
      );

      prismaService.member.findMany.mockImplementation(
        async (args: { where?: { phone?: unknown } }) => {
          const phone = args?.where?.phone;
          if (phone && typeof phone === 'object' && 'in' in phone) {
            return [{ id: 1, storeId: 5, beanBalance: 7 }];
          }
          if (phone === '13800138000') return [{ id: 2, storeId: 5 }]; // 目标已有 Member
          return [];
        },
      );
      prismaService.store.findMany.mockResolvedValue([]);
      authSessionService.signToken.mockResolvedValue({
        access_token: 'merged_token',
        userId: 99,
      });

      await service.bindPhone(42, { phone: '13800138000', code: '123456' });

      // 纯利豆结转，不能凭空消失
      expect(prismaService.member.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { beanBalance: { increment: 7 } },
      });
      // 软删除源 Member 并清空 phone：findAccessibleStores 的
      // members.some({ phone }) 不过滤 deletedAt，留旧号会造成串号
      expect(prismaService.member.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { phone: null, deletedAt: expect.any(Date) },
      });
      // 顾客资产并入目标
      expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: {
          balance: { increment: 645070 },
          points: { increment: 30 },
          totalSpent: { increment: 9000 },
          visitCount: { increment: 2 },
        },
      });
      expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { clubUserId: null, phone: null, deletedAt: expect.any(Date) },
      });

      // 消费 / 积分 / 充值流水是必填外键且无级联，硬删会直接抛错
      expect(prismaService.member.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── 批次 3：微信 getPhoneNumber 一键绑定 ─────────────────────────────────
  //
  // 该入口被「微信认证」阻塞，但接口与接线可以提前就绪：
  // 认证通过后只需打开 auth.wechatPhoneBindEnabled，无需再改代码。
  describe('bindPhoneByWechatCode', () => {
    const configGet = configServiceMock.get as jest.Mock;

    it('开关未打开时拒绝，且不向微信发起请求', async () => {
      configGet.mockReturnValueOnce(false);

      await expect(
        service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' }),
      ).rejects.toBeInstanceOf(NotImplementedException);

      expect(clubWechatAuthService.getPhoneNumber).not.toHaveBeenCalled();
    });

    it('开关打开时：用 code 换取手机号后委托 bindVerifiedPhone', async () => {
      configGet.mockReturnValueOnce(true);
      clubWechatAuthService.getPhoneNumber.mockResolvedValueOnce({
        phoneNumber: '+8613800138000',
        purePhoneNumber: '13800138000',
      });
      // 该手机号没有其它账号 → 走「直接绑定 + 占位值迁移」分支
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({
        id: 42,
        email: 'club_wechat_openid_abc@purelyprofit.local',
        wechatOpenid: 'openid_abc',
        wechatUnionid: null,
        wechatNickname: '微信昵称',
        wechatAvatar: null,
        wechatPhone: null,
      });
      prismaService.member.updateMany.mockResolvedValue({ count: 0 });
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 0 });
      authSessionService.signToken.mockResolvedValue({
        access_token: 'new_token',
        userId: 42,
      });

      await service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' });

      expect(clubWechatAuthService.getPhoneNumber).toHaveBeenCalledWith(
        'wx-phone-code',
      );
      // 走的是与短信绑定完全相同的核心逻辑（不重复实现）
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { wechatPhone: '13800138000' },
      });
      expect(authSessionService.signToken).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ phone: '13800138000' }),
      );
    });

    it('不校验短信验证码：手机号归属由微信背书', async () => {
      configGet.mockReturnValueOnce(true);
      clubWechatAuthService.getPhoneNumber.mockResolvedValueOnce({
        phoneNumber: '+8613800138000',
        purePhoneNumber: '13800138000',
      });
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue({
        id: 42,
        email: 'club_wechat_openid_abc@purelyprofit.local',
        wechatOpenid: 'openid_abc',
        wechatUnionid: null,
        wechatNickname: '微信昵称',
        wechatAvatar: null,
        wechatPhone: null,
      });
      prismaService.member.updateMany.mockResolvedValue({ count: 0 });
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 0 });
      authSessionService.signToken.mockResolvedValue({
        access_token: 'new_token',
        userId: 42,
      });

      await service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' });

      expect(
        authCodeVerifyService.ensureRegisterCodeValid,
      ).not.toHaveBeenCalled();
    });

    it('非大陆手机号（如海外号）不进入绑定流程', async () => {
      configGet.mockReturnValueOnce(true);
      clubWechatAuthService.getPhoneNumber.mockResolvedValueOnce({
        phoneNumber: '+85212345678',
        purePhoneNumber: '12345678',
      });

      await expect(
        service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('开关未配置（undefined）同样拒绝：环境漏配不等于开放', async () => {
      // 生产默认 false；这里模拟「配置项压根没配」——
      // 判定是 enabled !== true，undefined/false 都不该放行
      configGet.mockReturnValueOnce(undefined);

      await expect(
        service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' }),
      ).rejects.toBeInstanceOf(NotImplementedException);

      expect(clubWechatAuthService.getPhoneNumber).not.toHaveBeenCalled();
    });

    it('微信侧换取手机号失败（code 失效）：错误透传，不写库也不签发 token', async () => {
      configGet.mockReturnValueOnce(true);
      clubWechatAuthService.getPhoneNumber.mockRejectedValueOnce(
        new BadRequestException('code 已失效'),
      );

      await expect(
        service.bindPhoneByWechatCode(42, { code: 'wx-phone-code' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // 换取失败意味着手机号来源不可信，任何写库与签发都必须不发生
      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(authSessionService.signToken).not.toHaveBeenCalled();
    });
  });

  describe('登录即注册与验证码委托', () => {
    it('loginByCode 委托 AuthProductAuthService.loginByCodeOrRegister', async () => {
      const dto = { phone: '13800138000', code: '123456' };
      authProductAuthService.loginByCodeOrRegister.mockResolvedValue({
        access_token: 'tok',
        userId: 7,
      });

      const result = await service.loginByCode(dto);

      expect(authProductAuthService.loginByCodeOrRegister).toHaveBeenCalledWith(
        dto,
        'purely_club',
      );
      expect(result).toEqual({ access_token: 'tok', userId: 7 });
    });

    it('sendLoginCode / sendBindPhoneCode 委托发送服务', async () => {
      authProductAuthService.sendClubLoginOrRegisterCode.mockResolvedValue({
        message: 'ok',
        expiresInSeconds: 600,
      });
      authProductAuthService.sendBindPhoneCode.mockResolvedValue({
        message: 'ok',
        expiresInSeconds: 600,
      });

      await service.sendLoginCode({ phone: '13800138000' });
      await service.sendBindPhoneCode({ phone: '13800138000' });

      expect(
        authProductAuthService.sendClubLoginOrRegisterCode,
      ).toHaveBeenCalledWith({
        phone: '13800138000',
        captchaToken: undefined,
      });
      expect(authProductAuthService.sendBindPhoneCode).toHaveBeenCalledWith({
        phone: '13800138000',
        captchaToken: undefined,
      });
    });
  });

  // ─── 换绑手机号 ──────────────────────────────────────────────────────────
  //
  // 与「首次绑定」的三条差异都是安全边界（不合并 / 只验新号 / 按 clubUserId 定位），
  // 因此每个反例单独锁一条。

  describe('rebindPhone', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    // 用线上事故的真实号码：自动展示名刚好是「纯利会员4011」→「纯利会员4010」
    const PREVIOUS_PHONE = '15919654011';
    const CURRENT_EMAIL = 'club_wechat_openid_abc@purelyprofit.local';
    const dto = { phone: '15919654010', code: '1234' };

    const buildPhoneUserRecord = (id: number): PhoneUserRecord => ({
      id,
      email: `club_phone_${id}@purelyprofit.local`,
      password: '',
      phone: dto.phone,
      accountScope: 'purely_club',
    });

    interface CurrentUserOverrides {
      wechatPhone?: string | null;
      phoneRebindAt?: Date | null;
    }

    const prepareCurrentUser = (
      overrides: CurrentUserOverrides = {},
    ): void => {
      prismaService.user.findUnique.mockResolvedValue({
        email: CURRENT_EMAIL,
        wechatPhone: PREVIOUS_PHONE,
        phoneRebindAt: null,
        ...overrides,
      });
      // clearAllMocks 不会重置 mock 实现，需显式给回默认值，
      // 否则上一个用例设的「新号已属于他人」会泄漏到下一个用例
      authAccountLookupService.findUserByPhone.mockResolvedValue(null);
    };

    /** 让一次换绑走通到「写库 → 清缓存 → 签发 token」 */
    const prepareHappyPath = (
      storeIds: number[] = [37],
      userOverrides: CurrentUserOverrides = {},
      options: { unboundCustomers?: { id: number; storeId: number }[] } = {},
    ): void => {
      prepareCurrentUser(userOverrides);
      const unboundCustomers = options.unboundCustomers ?? [];
      // 已认领的孤儿门店：认领后必须出现在「clubUserId=42 的门店」查询结果里，
      // 否则 storeIds 会漏掉它们，Member 也就整店不同步。
      const claimedStoreIds = new Set<number>();

      // 按查询条件而非调用顺序返回：换绑内部会分别查「已绑定门店」与「孤儿档案」
      // 两次 findMany，按顺序 mock 会让实现偷偷变化也照样绿。
      prismaService.marketingCustomer.findMany.mockImplementation(
        async (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          if (where.clubUserId === 42) {
            return [...storeIds, ...claimedStoreIds].map((storeId) => ({
              storeId,
            }));
          }
          if (where.clubUserId === null) {
            return unboundCustomers;
          }
          return [];
        },
      );
      // 门店侧手机号唯一性检查：默认无冲突
      prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
      prismaService.marketingCustomer.updateMany.mockImplementation(
        async (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          if (typeof where.id === 'number' && where.clubUserId === null) {
            const claimed = unboundCustomers.find(
              (item) => item.id === where.id,
            );
            if (claimed) {
              claimedStoreIds.add(claimed.storeId);
            }
          }
          return { count: storeIds.length };
        },
      );
      prismaService.member.updateMany.mockResolvedValue({
        count: storeIds.length,
      });
      authSessionService.signToken.mockResolvedValue({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });
    };

    it('校验并一次性消费新手机号验证码', async () => {
      prepareHappyPath();

      await service.rebindPhone(42, dto);

      expect(
        authCodeVerifyService.ensureRegisterCodeValid,
      ).toHaveBeenCalledWith(dto.phone, dto.code, 'purely_club');
      expect(authCodeVerifyService.clearRegisterCode).toHaveBeenCalledWith(
        dto.phone,
        'purely_club',
      );
    });

    it('尚未绑定手机号的账号被拒绝：应走首次绑定（可能触发合并）', async () => {
      prepareCurrentUser({ wechatPhone: null });

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        '当前账号尚未绑定手机号，请先绑定手机号',
      );

      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(authSessionService.signToken).not.toHaveBeenCalled();
    });

    it('新手机号与当前一致时拒绝，且不写库', async () => {
      prepareCurrentUser({ wechatPhone: dto.phone });

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        '新手机号与当前手机号相同',
      );

      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('新手机号已属于其他账号 → 拒绝，且绝不触发账号合并', async () => {
      prepareCurrentUser();
      authAccountLookupService.findUserByPhone.mockResolvedValue(
        buildPhoneUserRecord(999),
      );

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        '该手机号已绑定其他账号，请更换手机号',
      );

      // 合并语义属于「找回账号」；在换绑里合并会吃掉另一个账号的档案与资产
      expect(prismaService.marketingCustomer.updateMany).not.toHaveBeenCalled();
      expect(prismaService.member.updateMany).not.toHaveBeenCalled();
      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('冷静期内重复换绑被拒绝，并告知剩余天数', async () => {
      prepareCurrentUser({
        phoneRebindAt: new Date(Date.now() - 5 * DAY_MS),
      });

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        /手机号换绑过于频繁，请 \d+ 天后再试/,
      );
      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('超过冷静期后允许换绑', async () => {
      prepareHappyPath([37], {
        phoneRebindAt: new Date(Date.now() - 31 * DAY_MS),
      });

      await expect(service.rebindPhone(42, dto)).resolves.toEqual({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });
    });

    it('换绑写入新手机号并记录换绑时间', async () => {
      prepareHappyPath();

      await service.rebindPhone(42, dto);

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { wechatPhone: dto.phone, phoneRebindAt: expect.any(Date) },
      });
    });

    it('营销档案按 clubUserId 定位，绝不按旧 phone 更新 —— 旧号可能属于其他用户', async () => {
      prepareHappyPath([37, 38]);

      await service.rebindPhone(42, dto);

      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { clubUserId: 42 },
        data: { phone: dto.phone },
      });
      // 每一处档案更新都必须带门店限定，否则会串改「恰好拥有该旧号」的其他用户档案
      for (const call of prismaService.marketingCustomer.updateMany.mock.calls) {
        const where = (call[0] as { where: Record<string, unknown> }).where;
        expect(
          where.clubUserId !== undefined || where.storeId !== undefined,
        ).toBe(true);
      }
    });

    it('Member 按「该用户有档案的门店 + 旧号」定位，不依赖 customerId', async () => {
      prepareHappyPath([37, 38]);

      await service.rebindPhone(42, dto);

      // 线上事故：现存 Member 的 customer_id 全为 null，按 customerId 定位会命中 0 条，
      // Member.phone 留在旧号 → 新 token 用新号匹配不到门店 → 用户当场失去全部门店访问权
      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { storeId: { in: [37, 38] }, phone: PREVIOUS_PHONE },
        data: { phone: dto.phone },
      });
    });

    it('Member 定位必须限定门店，否则会串改其他用户的档案', async () => {
      prepareHappyPath([37]);

      await service.rebindPhone(42, dto);

      for (const call of prismaService.member.updateMany.mock.calls) {
        const where = (call[0] as { where: Record<string, unknown> }).where;
        expect(where.storeId).toBeDefined();
      }
    });

    it('同步自动生成的展示名 —— 否则商家端一直显示旧号后 4 位', async () => {
      prepareHappyPath([37]);

      await service.rebindPhone(42, dto);

      // 「纯利会员4011」→「纯利会员4010」。仅在名字恰为自动生成的那个时才改，
      // 避免覆盖商家在 purelyProfit 手动改过的名字。
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { clubUserId: 42, phone: dto.phone, name: '纯利会员4011' },
        data: { name: '纯利会员4010' },
      });
      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: { in: [37] },
          phone: dto.phone,
          name: '纯利会员4011',
        },
        data: { name: '纯利会员4010' },
      });
    });

    it('清「可访问门店」缓存，避免 60 秒内仍按旧号匹配门店', async () => {
      prepareHappyPath();

      await service.rebindPhone(42, dto);

      expect(
        clubStoreAccessService.invalidateAccessibleStoresCache,
      ).toHaveBeenCalledWith(42);
    });

    it('返回携带新手机号的 token：JWT 的 phone 参与可访问门店匹配', async () => {
      prepareHappyPath();

      await service.rebindPhone(42, dto);

      expect(authSessionService.signToken).toHaveBeenCalledWith(42, {
        phone: dto.phone,
        email: CURRENT_EMAIL,
        accountScope: 'purely_club',
      });
    });

    // ─── 以下三条锁定「按 clubUserId 定位」的历史缺口 ───────────────────────

    it('认领无 clubUserId 的同号孤儿档案，避免整店漏同步', async () => {
      // 线上事故形态：早期「邀请码入店」生成的顧客档案没写 club_user_id，
      // 只按 clubUserId 定位会把门店 55 整家漏掉 —— members.phone 停在旧号，
      // 用户当场失去该门店，商家端营销档案也仍旧号，再消费还会分裂出第二条档案。
      prepareHappyPath([37], {}, {
        unboundCustomers: [{ id: 901, storeId: 55 }],
      });

      await service.rebindPhone(42, dto);

      // 认领本身带 clubUserId 为 null 的条件，防止并发抢绑写到他人名下
      expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: { id: 901, clubUserId: null },
        data: { clubUserId: 42 },
      });
      // Member 同步的门店范围必须包含被认领的门店
      expect(prismaService.member.updateMany).toHaveBeenCalledWith({
        where: { storeId: { in: [37, 55] }, phone: PREVIOUS_PHONE },
        data: { phone: dto.phone },
      });
    });

    it('门店内已有他人占用新号时拒绝换绑，且不写库', async () => {
      prepareHappyPath();
      // 商家端 ensureUniquePhone 保证「门店 + 手机号」唯一；换绑是批量 update，
      // 不补这道校验会留下两条同号档案，marketing-consumption-link 按
      // (storeId, phone) findFirst 关联时会把消费挂到错误档案上。
      prismaService.marketingCustomer.findFirst.mockResolvedValue({
        id: 777,
        storeId: 37,
      });

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        '该手机号已被门店内的其他顾客档案占用',
      );

      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(prismaService.marketingCustomer.updateMany).not.toHaveBeenCalled();
      expect(prismaService.member.updateMany).not.toHaveBeenCalled();
    });

    it('确定性失败（冷静期 / 他人占用 / 同号）不消费验证码', async () => {
      // 验证码是一次性资源：被这些与验证码无关的失败白白消费掉，
      // 用户必须重新获取短信才能再试一次。
      prepareHappyPath([], { phoneRebindAt: new Date(Date.now() - 5 * DAY_MS) });

      await expect(service.rebindPhone(42, dto)).rejects.toThrow(
        /手机号换绑过于频繁/,
      );

      expect(
        authCodeVerifyService.ensureRegisterCodeValid,
      ).not.toHaveBeenCalled();
      expect(authCodeVerifyService.clearRegisterCode).not.toHaveBeenCalled();
    });
  });
});
