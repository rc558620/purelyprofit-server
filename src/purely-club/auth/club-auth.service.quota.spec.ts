import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import {
  NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
} from '../../purely-profit/member/new-customer-quota/new-customer-quota.constants';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { ClubAccountMergeService } from './club-account-merge.service';
import { ClubAuthService } from './club-auth.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubPhoneBindService } from './club-phone-bind.service';
import { ClubPhoneRebindService } from './club-phone-rebind.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

/** 构造唯一约束冲突（同店同顾客重复扣减） */
const buildUniqueConstraintError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
  });

/**
 * 绑定手机号链路的「新用户额度」行为测试。
 *
 * 真实微信授权无法在单测里复现，因此把 getPhoneNumber（微信侧）与
 * bindVerifiedPhone（落库侧）都换成 mock，只验证额度相关的编排：
 * 预检时机、拦截错误码、新客扣减、老客不扣、重复绑定幂等、无门店不拦截。
 *
 * 两条绑定入口（短信 bindPhone / 微信 bindPhoneByWechatCode）都要覆盖——
 * 微信入口受 auth.wechatPhoneBindEnabled 控制、默认关闭，前端会撤掉一键授权按钮
 * 展开短信表单，短信任一条链路没接额度闸门就是一条完整的绕过路径。
 *
 * 额度服务用**真实实现**（PrismService 为 mock），保证测的是真实扣减逻辑。
 */
describe('ClubAuthService 新用户额度', () => {
  let service: ClubAuthService;

  const REAL_PHONE = '13800000000';

  /** 真实额度服务依赖的 Prisma delegate（事务内外共用） */
  const delegates = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storeNewCustomerQuotaLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    storeNewCustomerQuotaConsume: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    scanOrderingSession: {
      findFirst: jest.fn(),
    },
  };

  const prismaService = {
    ...delegates,
    $transaction: jest.fn((fn: (tx: typeof delegates) => Promise<unknown>) =>
      fn(delegates),
    ),
  };

  const clubWechatAuthService = {
    getPhoneNumber: jest.fn(),
  };

  const clubPhoneBindService = {
    bindVerifiedPhone: jest.fn(),
  };

  const clubCurrentStoreContextService = {
    getCurrentStore: jest.fn(),
  };

  const authCodeVerifyService = {
    ensureRegisterCodeValid: jest.fn(),
    clearRegisterCode: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string): unknown =>
      key === 'auth.wechatPhoneBindEnabled' ? true : undefined,
    ),
  };

  const USER_ID = 1001;
  /** 额度链路只用到 user.id，其余字段用最小对象 + 断言补型 */
  const buildUser = (): AuthenticatedUser =>
    ({
      id: USER_ID,
      email: 'club@test.com',
      phone: null,
    }) as unknown as AuthenticatedUser;

  /** 调用微信一键绑定：签名是 (userId, dto, currentUser?) */
  const bindByWechatCode = (sessionId?: number): Promise<unknown> =>
    service.bindPhoneByWechatCode(
      USER_ID,
      { code: 'wx-code', ...(sessionId ? { sessionId } : {}) },
      buildUser(),
    );

  /** 调用短信验证码绑定：签名是 (userId, dto, currentUser?) */
  const bindBySms = (sessionId?: number): Promise<unknown> =>
    service.bindPhone(
      USER_ID,
      {
        phone: REAL_PHONE,
        code: '123456',
        ...(sessionId ? { sessionId } : {}),
      },
      buildUser(),
    );

  /** 捕获抛出的业务异常，便于断言响应体里的业务码 */
  const captureError = async (): Promise<ForbiddenException> => {
    try {
      await bindByWechatCode();
    } catch (error) {
      return error as ForbiddenException;
    }
    throw new Error('预期抛出 ForbiddenException，但实际成功');
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    clubWechatAuthService.getPhoneNumber.mockResolvedValue({
      purePhoneNumber: REAL_PHONE,
    });
    clubPhoneBindService.bindVerifiedPhone.mockResolvedValue({
      access_token: 'token',
    });
    clubCurrentStoreContextService.getCurrentStore.mockResolvedValue({
      id: 42,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 10,
    });
    delegates.storeNewCustomerQuotaLog.aggregate.mockResolvedValue({
      _sum: { changeAmount: 0 },
    });
    // 默认按「本店新客」：无消耗记录
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubAuthService,
        NewCustomerQuotaService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubWechatAuthService, useValue: clubWechatAuthService },
        { provide: ClubPhoneBindService, useValue: clubPhoneBindService },
        { provide: ClubPhoneRebindService, useValue: {} },
        { provide: ClubAccountMergeService, useValue: {} },
        { provide: AuthProductAuthService, useValue: {} },
        {
          provide: AuthCodeVerifyService,
          useValue: authCodeVerifyService,
        },
        {
          provide: ClubCurrentStoreContextService,
          useValue: clubCurrentStoreContextService,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ClubAuthService>(ClubAuthService);
  });

  it('额度为 0：在调用微信 getPhoneNumber 之前就拦截（不产生接口费用）', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(bindByWechatCode()).rejects.toBeInstanceOf(ForbiddenException);

    expect(clubWechatAuthService.getPhoneNumber).not.toHaveBeenCalled();
    expect(clubPhoneBindService.bindVerifiedPhone).not.toHaveBeenCalled();
  });

  it('额度为 0：错误体带 NEW_CUSTOMER_QUOTA_EXHAUSTED 业务码，供 C 端提示', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    const error = await captureError();

    expect(error.getResponse()).toEqual({
      message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
      code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
    });
  });

  it('新客绑定：绑定成功后扣减 1 位新客额度并写消耗流水', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 9,
    });

    await bindByWechatCode();

    expect(clubWechatAuthService.getPhoneNumber).toHaveBeenCalledWith(
      'wx-code',
    );
    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalledWith(
      1001,
      REAL_PHONE,
    );
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 42, newCustomerQuota: { gt: 0 } },
      }),
    );
    expect(delegates.storeNewCustomerQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consume',
          changeAmount: -1,
          balanceAfter: 9,
        }),
      }),
    );
  });

  it('老客户（本店已消耗过额度）重复绑定不扣减额度', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 777,
    });
    delegates.storeNewCustomerQuotaConsume.create.mockRejectedValue(
      buildUniqueConstraintError(),
    );

    await bindByWechatCode();

    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
    expect(delegates.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('老客户在额度为 0 时仍可绑定（额度只限制新客，不误伤老客）', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 777,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(bindByWechatCode()).resolves.toEqual({
      access_token: 'token',
    });
    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
  });

  it('无可访问门店时不拦截也不扣减（绑定是账号级操作）', async () => {
    clubCurrentStoreContextService.getCurrentStore.mockRejectedValue(
      new Error('NO_ACCESSIBLE_STORE'),
    );

    await bindByWechatCode();

    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
  });

  it('额度扣减失败不影响已完成的绑定（只告警，不抛给 C 端）', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockRejectedValue(
      new Error('db down'),
    );

    await expect(bindByWechatCode()).resolves.toEqual({
      access_token: 'token',
    });
  });

  // ─── 短信验证码链路：不能在额度上被绕过去 ───────────────────────────────────

  it('短信绑定：额度为 0 时同样被拦截，且带 NEW_CUSTOMER_QUOTA_EXHAUSTED 业务码', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    const error = await (async () => {
      try {
        await bindBySms();
      } catch (caught) {
        return caught as ForbiddenException;
      }
      throw new Error('预期抛出 ForbiddenException，但实际成功');
    })();

    expect(error.getResponse()).toEqual({
      message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
      code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
    });
    expect(clubPhoneBindService.bindVerifiedPhone).not.toHaveBeenCalled();
  });

  it('短信绑定：被拦截时不消耗验证码（一次性且按条计费，不能白扣）', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(bindBySms()).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      authCodeVerifyService.ensureRegisterCodeValid,
    ).not.toHaveBeenCalled();
    expect(authCodeVerifyService.clearRegisterCode).not.toHaveBeenCalled();
  });

  it('短信绑定：新客绑定成功后扣减 1 位新客额度', async () => {
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 9,
    });

    await bindBySms();

    expect(authCodeVerifyService.ensureRegisterCodeValid).toHaveBeenCalledWith(
      REAL_PHONE,
      '123456',
      'purely_club',
    );
    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalledWith(
      1001,
      REAL_PHONE,
    );
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 42, newCustomerQuota: { gt: 0 } },
      }),
    );
  });

  it('短信绑定：老客户在额度为 0 时仍可绑定（不误伤老客）', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 777,
    });
    // 已有消耗记录 → 唯一约束冲突，扣减退化为 no-op
    delegates.storeNewCustomerQuotaConsume.create.mockRejectedValue(
      buildUniqueConstraintError(),
    );
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
    });

    await expect(bindBySms()).resolves.toEqual({ access_token: 'token' });
    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
  });

  // ─── 门店归属：必须与「扫码进的那家店」一致 ─────────────────────────────────

  it('传 sessionId：额度按会话所属门店扣减，而非当前选中门店', async () => {
    const SESSION_STORE_ID = 88;
    delegates.scanOrderingSession.findFirst.mockResolvedValue({
      storeId: SESSION_STORE_ID,
    });
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 9,
    });

    await bindBySms(9527);

    expect(delegates.scanOrderingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 9527,
          clubUserId: USER_ID,
          status: 'active',
        }),
      }),
    );
    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: SESSION_STORE_ID, newCustomerQuota: { gt: 0 } },
      }),
    );
    // 会话可用时不该再读「当前选中门店」
    expect(clubCurrentStoreContextService.getCurrentStore).not.toHaveBeenCalled();
  });

  it('传 sessionId：微信链路同样按会话所属门店判定', async () => {
    const SESSION_STORE_ID = 88;
    delegates.scanOrderingSession.findFirst.mockResolvedValue({
      storeId: SESSION_STORE_ID,
    });
    delegates.storeNewCustomerQuotaConsume.create.mockResolvedValue({ id: 1 });
    delegates.storeMembershipProfile.updateMany.mockResolvedValue({ count: 1 });

    await bindByWechatCode(9527);

    expect(delegates.storeMembershipProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: SESSION_STORE_ID, newCustomerQuota: { gt: 0 } },
      }),
    );
  });

  it('会话不存在 / 已结束时不拦截也不扣减（避免拿已失效的会话锁定门店）', async () => {
    delegates.scanOrderingSession.findFirst.mockResolvedValue(null);

    await expect(bindBySms(9527)).resolves.toEqual({ access_token: 'token' });

    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
  });

  it('预检接口：新客在额度充足时 blocked=false，额度为 0 时 blocked=true', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 10,
      newCustomerQuotaConsumed: 1,
    });
    await expect(
      service.getNewCustomerQuotaStatus(buildUser()),
    ).resolves.toEqual({
      isNewCustomer: true,
      blocked: false,
      remaining: 10,
    });

    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 0,
      newCustomerQuotaConsumed: 1,
    });
    await expect(
      service.getNewCustomerQuotaStatus(buildUser()),
    ).resolves.toEqual({
      isNewCustomer: true,
      blocked: true,
      remaining: 0,
    });
  });

  it('预检接口：老客恒为 blocked=false（额度耗尽也不挡老客）', async () => {
    delegates.storeNewCustomerQuotaConsume.findUnique.mockResolvedValue({
      id: 777,
    });
    delegates.storeMembershipProfile.findUnique.mockResolvedValue({
      newCustomerQuota: 0,
      newCustomerQuotaConsumed: 99,
    });

    await expect(
      service.getNewCustomerQuotaStatus(buildUser()),
    ).resolves.toEqual({
      isNewCustomer: false,
      blocked: false,
      remaining: 0,
    });
  });

  it('预检接口：无门店时不拦截', async () => {
    clubCurrentStoreContextService.getCurrentStore.mockRejectedValue(
      new Error('NO_ACCESSIBLE_STORE'),
    );

    await expect(
      service.getNewCustomerQuotaStatus(buildUser()),
    ).resolves.toEqual({
      isNewCustomer: false,
      blocked: false,
      remaining: 0,
    });
  });
});
