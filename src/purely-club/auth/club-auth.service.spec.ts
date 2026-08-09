import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubAuthService } from './club-auth.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

describe('ClubAuthService', () => {
  let service: ClubAuthService;
  let authProductAuthService: jest.Mocked<AuthProductAuthService>;
  let clubWechatAuthService: jest.Mocked<ClubWechatAuthService>;
  let authCodeVerifyService: jest.Mocked<AuthCodeVerifyService>;
  let authAccountLookupService: jest.Mocked<AuthAccountLookupService>;
  let authSessionService: jest.Mocked<AuthSessionService>;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    member: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
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

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubAuthService,
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
      // 源用户无 Member、无门店
      prismaService.member.findMany.mockResolvedValue([]);
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
      prismaService.member.findMany
        .mockResolvedValueOnce([{ id: 1, storeId: 5 }])
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
});
