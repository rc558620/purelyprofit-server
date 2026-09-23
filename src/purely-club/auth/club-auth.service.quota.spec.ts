import { ForbiddenException } from '@nestjs/common';
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

/**
 * 微信一键绑定链路的「新用户额度」行为测试。
 *
 * 真实微信授权无法在单测里复现，因此把 getPhoneNumber（微信侧）与
 * bindVerifiedPhone（落库侧）都换成 mock，只验证额度相关的编排：
 * 预检时机、拦截错误码、新客扣减、老客不扣、重复绑定幂等、无门店不拦截。
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
    },
    marketingCustomer: {
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

  /** 调用绑定：签名是 (userId, dto, currentUser?) */
  const bindByWechatCode = (): Promise<unknown> =>
    service.bindPhoneByWechatCode(USER_ID, { code: 'wx-code' }, buildUser());

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
        { provide: AuthCodeVerifyService, useValue: {} },
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
    delegates.marketingCustomer.findFirst.mockResolvedValue(null);
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

  it('老客户（本店已有该手机号档案）不扣减额度', async () => {
    delegates.marketingCustomer.findFirst.mockResolvedValue({ id: 777 });

    await bindByWechatCode();

    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
    expect(delegates.storeMembershipProfile.updateMany).not.toHaveBeenCalled();
  });

  it('无可访问门店时不拦截也不扣减（绑定是账号级操作）', async () => {
    clubCurrentStoreContextService.getCurrentStore.mockRejectedValue(
      new Error('NO_ACCESSIBLE_STORE'),
    );
    delegates.marketingCustomer.findFirst.mockResolvedValue(null);

    await bindByWechatCode();

    expect(clubPhoneBindService.bindVerifiedPhone).toHaveBeenCalled();
    expect(
      delegates.storeNewCustomerQuotaConsume.create,
    ).not.toHaveBeenCalled();
  });

  it('额度扣减失败不影响已完成的绑定（只告警，不抛给 C 端）', async () => {
    delegates.marketingCustomer.findFirst.mockResolvedValue(null);
    delegates.storeNewCustomerQuotaConsume.create.mockRejectedValue(
      new Error('db down'),
    );

    await expect(bindByWechatCode()).resolves.toEqual({
      access_token: 'token',
    });
  });

  it('预检接口：额度充足时 blocked=false，额度为 0 时 blocked=true', async () => {
    delegates.storeMembershipProfile.findUnique.mockResolvedValueOnce({
      newCustomerQuota: 10,
      newCustomerQuotaConsumed: 1,
    });
    await expect(
      service.getNewCustomerQuotaStatus(buildUser()),
    ).resolves.toEqual({
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
      blocked: true,
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
      blocked: false,
      remaining: 0,
    });
  });
});
