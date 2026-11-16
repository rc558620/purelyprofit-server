import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import { ClubCardContextService } from './club-card-context.service';
import { ClubCardImmediateSettlementService } from './club-card-immediate-settlement.service';
import { ClubCardOrderService } from './club-card-order.service';
import { ClubCardSettlementService } from './club-card-settlement.service';

const user: AuthenticatedUser = {
  id: 201,
  email: 'club_phone_13800138000@purelyprofit.local',
  phone: '13800138000',
  name: '俱乐部用户',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
  accountScope: 'purely_club',
  currentMembership: null,
};

const currentContext: ClubCurrentContext = {
  user,
  store: {
    id: 11,
    name: '望京旗舰店',
    address: '北京市朝阳区望京 SOHO T3 B1',
    businessMode: 'general' as const,
    memberCareEnabled: false,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  },
};

const PLAN = {
  id: 7,
  kind: 'stored_value' as const,
  name: '储值卡',
  price: 19900,
  purchaseLimit: 3,
};

const CUSTOMER = {
  id: 98,
  balanceFen: 50000,
  guestName: '张三',
  guestPhone: '13800138000',
};

const ORDER_ROW = {
  id: 900,
  orderNo: 'MC202611020001',
  planId: 7,
  planNameSnapshot: '储值卡',
  amount: 19900,
  paymentChannel: 'wechat',
  status: 'unpaid',
  createdAt: new Date('2026-11-02T02:00:00.000Z'),
  expiresAt: new Date('2026-11-02T02:15:00.000Z'),
  paidAt: null,
};

/** 等待门闩：超过阈值仍未放行说明两段被串行执行了 */
const withTimeout = async <T>(
  promise: Promise<T>,
  message: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 2000);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

describe('ClubCardOrderService（并行化后契约不变）', () => {
  let service: ClubCardOrderService;
  let callOrder: string[];

  const prismaService = {
    memberCardOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    memberCard: { findFirst: jest.fn() },
  };
  const contextService = {
    assertStoreMatches: jest.fn(),
    resolvePlan: jest.fn(),
    resolveOwnCustomer: jest.fn(),
    countOwnedCards: jest.fn(),
  };
  const paymentModeService = { isManualConfirmPaidAllowed: jest.fn() };
  const jsapiService = { createJsapiPaymentParams: jest.fn() };
  const openidService = { resolveOpenid: jest.fn() };
  const idempotencyService = {
    normalizeKey: jest.fn(),
    findOrderNo: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  };
  const immediateSettlementService = { settle: jest.fn() };
  const settlementService = { settlePaidOrder: jest.fn() };
  const wechatVerifyService = { confirmPaidOnWechat: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    callOrder = [];

    idempotencyService.normalizeKey.mockReturnValue(null);
    contextService.resolvePlan.mockImplementation(() => {
      callOrder.push('plan');
      return Promise.resolve({ plan: PLAN, storeName: '望京旗舰店' });
    });
    contextService.resolveOwnCustomer.mockImplementation(() => {
      callOrder.push('customer');
      return Promise.resolve(CUSTOMER);
    });
    paymentModeService.isManualConfirmPaidAllowed.mockImplementation(() => {
      callOrder.push('mode');
      return Promise.resolve(false);
    });
    contextService.countOwnedCards.mockResolvedValue(0);
    openidService.resolveOpenid.mockImplementation(() => {
      callOrder.push('openid');
      return Promise.resolve('openid-1');
    });
    jsapiService.createJsapiPaymentParams.mockImplementation(() => {
      callOrder.push('jsapi');
      return Promise.resolve({ paySign: 'sign' });
    });
    prismaService.memberCardOrder.create.mockImplementation(() => {
      callOrder.push('create');
      return Promise.resolve(ORDER_ROW);
    });
    immediateSettlementService.settle.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCardOrderService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubCardContextService, useValue: contextService },
        { provide: ClubPaymentModeService, useValue: paymentModeService },
        { provide: ClubWechatJsapiService, useValue: jsapiService },
        { provide: ClubWechatOpenidService, useValue: openidService },
        { provide: ClubOrderIdempotencyService, useValue: idempotencyService },
        { provide: ClubCardSettlementService, useValue: settlementService },
        {
          provide: ClubCardImmediateSettlementService,
          useValue: immediateSettlementService,
        },
        { provide: ClubWechatVerifyService, useValue: wechatVerifyService },
      ],
    }).compile();

    service = module.get<ClubCardOrderService>(ClubCardOrderService);
  });

  const dto = { storeId: 11, planId: '7', paymentMethod: 'wechat' as const };

  it('微信支付建单：落 unpaid、带支付参数，预下单在落库之前', async () => {
    const result = await service.createOrder(currentContext, dto);

    expect(prismaService.memberCardOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'unpaid',
        amount: 19900,
        unitAmount: 19900,
        quantity: 1,
        planId: 7,
        customerId: 98,
        clubUserId: 201,
        paymentChannel: 'wechat',
      }),
    });
    expect(result.paymentParams).toEqual({ paySign: 'sign' });
    expect(callOrder.indexOf('jsapi')).toBeLessThan(
      callOrder.indexOf('create'),
    );
    expect(immediateSettlementService.settle).toHaveBeenCalled();
  });

  it('卡模板 / 本人档案 / 支付模式三读并行', async () => {
    let releaseMode: () => void = () => {};
    const modeGate = new Promise<void>((resolve) => {
      releaseMode = resolve;
    });
    contextService.resolvePlan.mockImplementation(async () => {
      await withTimeout(modeGate, '卡模板解析未与支付模式判定并行');
      return { plan: PLAN, storeName: '望京旗舰店' };
    });
    paymentModeService.isManualConfirmPaidAllowed.mockImplementation(() => {
      releaseMode();
      return Promise.resolve(false);
    });

    await expect(
      service.createOrder(currentContext, dto),
    ).resolves.toBeDefined();
  });

  it('限购门禁优先于 openid 解析失败，且门禁未通过时不落库', async () => {
    contextService.countOwnedCards.mockResolvedValue(3);
    openidService.resolveOpenid.mockRejectedValue(new Error('openid-failed'));

    await expect(service.createOrder(currentContext, dto)).rejects.toThrow(
      '该卡每人限购 3 张',
    );
    expect(prismaService.memberCardOrder.create).not.toHaveBeenCalled();
  });

  it('余额支付：不读支付模式、不解析 openid，直接落账发卡', async () => {
    immediateSettlementService.settle.mockResolvedValue({ cardId: 501 });
    prismaService.memberCardOrder.findUnique.mockResolvedValue(ORDER_ROW);

    const result = await service.createOrder(currentContext, {
      storeId: 11,
      planId: '7',
      paymentMethod: 'balance',
    });

    expect(
      paymentModeService.isManualConfirmPaidAllowed,
    ).not.toHaveBeenCalled();
    expect(openidService.resolveOpenid).not.toHaveBeenCalled();
    expect(jsapiService.createJsapiPaymentParams).not.toHaveBeenCalled();
    expect(result.cardId).toBe('501');
  });

  it('零元卡：价格为 0 时不解析 openid、不预下单', async () => {
    contextService.resolvePlan.mockResolvedValue({
      plan: { ...PLAN, price: 0 },
      storeName: '望京旗舰店',
    });

    const result = await service.createOrder(currentContext, dto);

    expect(openidService.resolveOpenid).not.toHaveBeenCalled();
    expect(jsapiService.createJsapiPaymentParams).not.toHaveBeenCalled();
    expect(result.paymentParams).toBeUndefined();
  });

  it('幂等命中：复用上一笔订单，不再建单', async () => {
    idempotencyService.normalizeKey.mockReturnValue('key-1');
    idempotencyService.findOrderNo.mockResolvedValue('MC202611020001');
    prismaService.memberCardOrder.findFirst.mockResolvedValue(ORDER_ROW);
    prismaService.memberCard.findFirst.mockResolvedValue(null);

    const result = await service.createOrder(currentContext, dto, 'key-1');

    expect(result.orderNo).toBe('MC202611020001');
    expect(prismaService.memberCardOrder.create).not.toHaveBeenCalled();
    expect(contextService.resolvePlan).not.toHaveBeenCalled();
  });

  it('建单失败：释放幂等占位，错误原样抛出', async () => {
    idempotencyService.normalizeKey.mockReturnValue('key-2');
    idempotencyService.findOrderNo.mockResolvedValue(null);
    idempotencyService.reserve.mockResolvedValue(null);
    idempotencyService.release.mockResolvedValue(undefined);
    prismaService.memberCardOrder.create.mockRejectedValue(
      new Error('create-broken'),
    );

    await expect(
      service.createOrder(currentContext, dto, 'key-2'),
    ).rejects.toThrow('create-broken');
    expect(idempotencyService.release).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'key-2', userId: 201 }),
    );
  });
});
