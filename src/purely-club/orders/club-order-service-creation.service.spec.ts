import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { ClubOrderServiceCreationService } from './club-order-service-creation.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';

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

const ORDER_CONTEXT = {
  store: { id: 11, name: '望京旗舰店' },
  customer: { id: 98 },
  product: {
    id: 5,
    name: '经典养护套餐',
    price: 10000,
    originalPrice: 12000,
    costPrice: null,
    image: null,
    stock: 10,
  },
};

const PRICING = {
  amountFen: 9000,
  memberBaselineFen: 10000,
  discountAmountFen: 1000,
  promotionId: null,
  promotionType: null,
  discountRate: null,
  promotionTag: null,
  promotionDiscountAmountFen: 0,
  totalReduceFen: 0,
  amountFenBeforeReduce: 9000,
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

describe('ClubOrderServiceCreationService（并行化后契约不变）', () => {
  let service: ClubOrderServiceCreationService;
  let callOrder: string[];

  const prismaService = {
    marketingCustomer: { findUnique: jest.fn() },
    marketingMemberLevelSetting: { findUnique: jest.fn() },
  };
  const draftsService = {
    createDraft: jest.fn(),
    deleteDraft: jest.fn(),
    getDraft: jest.fn(),
    toServiceOrderResponse: jest.fn(),
  };
  const promotionsService = {
    preloadPricingContext: jest.fn(),
    resolvePricing: jest.fn(),
    resolveOrderReduceFen: jest.fn(),
  };
  const contextService = {
    resolveCreateServiceOrderContext: jest.fn(),
    buildDraftMetadata: jest.fn(),
  };
  const jsapiService = { createJsapiPaymentParams: jest.fn() };
  const openidService = { resolveOpenid: jest.fn() };
  const paymentModeService = { isManualConfirmPaidAllowed: jest.fn() };
  const downgradeService = { assertStoreCanOrder: jest.fn() };
  const quotaService = {
    assertAvailableForOrder: jest.fn(),
    consumeForOrder: jest.fn(),
  };
  const idempotencyService = {
    normalizeKey: jest.fn(),
    findOrderNo: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    callOrder = [];

    idempotencyService.normalizeKey.mockReturnValue(null);
    downgradeService.assertStoreCanOrder.mockImplementation(() => {
      callOrder.push('storeGate');
      return Promise.resolve();
    });
    contextService.resolveCreateServiceOrderContext.mockImplementation(() => {
      callOrder.push('orderContext');
      return Promise.resolve(ORDER_CONTEXT);
    });
    quotaService.assertAvailableForOrder.mockResolvedValue(true);
    promotionsService.preloadPricingContext.mockResolvedValue({
      promotions: [],
      hasConsumption: false,
    });
    promotionsService.resolvePricing.mockResolvedValue(PRICING);
    promotionsService.resolveOrderReduceFen.mockResolvedValue(500);
    paymentModeService.isManualConfirmPaidAllowed.mockResolvedValue(false);
    openidService.resolveOpenid.mockResolvedValue('openid-1');
    jsapiService.createJsapiPaymentParams.mockImplementation(() => {
      callOrder.push('jsapi');
      return Promise.resolve({ paySign: 'sign' });
    });
    contextService.buildDraftMetadata.mockReturnValue({ meta: true });
    draftsService.createDraft.mockImplementation(() => {
      callOrder.push('createDraft');
      return Promise.resolve({ orderNo: 'order-1' });
    });
    draftsService.toServiceOrderResponse.mockReturnValue({
      orderNo: 'order-1',
      reused: false,
    });
    draftsService.deleteDraft.mockResolvedValue(undefined);
    quotaService.consumeForOrder.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubOrderServiceCreationService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubOrderDraftsService, useValue: draftsService },
        { provide: ClubOrderPromotionsService, useValue: promotionsService },
        { provide: ClubOrderServiceContextService, useValue: contextService },
        { provide: ClubWechatJsapiService, useValue: jsapiService },
        { provide: ClubWechatOpenidService, useValue: openidService },
        { provide: ClubPaymentModeService, useValue: paymentModeService },
        { provide: MembershipDowngradeService, useValue: downgradeService },
        { provide: ClubNewCustomerQuotaService, useValue: quotaService },
        { provide: ClubOrderIdempotencyService, useValue: idempotencyService },
      ],
    }).compile();

    service = module.get<ClubOrderServiceCreationService>(
      ClubOrderServiceCreationService,
    );
  });

  const dto = { storeId: 11, productId: 5, quantity: 1, usePoints: false };

  it('成功建单：金额、草稿参数、扣额度与响应与改前一致', async () => {
    const result = await service.createServiceOrder(currentContext, dto);

    expect(result).toEqual({ orderNo: 'order-1', reused: false });
    // 9000（活动价）×1 - 500（满减）- 0（积分）
    expect(draftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 11,
        storeName: '望京旗舰店',
        customerId: 98,
        title: '购买经典养护套餐',
        amountFen: 8500,
        metadata: { meta: true },
        paymentParams: { paySign: 'sign' },
      }),
    );
    expect(contextService.buildDraftMetadata).toHaveBeenCalledWith(
      ORDER_CONTEXT.product,
      expect.objectContaining({
        totalReduceFen: 500,
        // 单件活动优惠 × 数量 + 整单满减 = 1000 × 1 + 500
        discountAmountFen: 1500,
      }),
      0,
      0,
      1,
    );
    expect(quotaService.consumeForOrder).toHaveBeenCalledWith(
      11,
      201,
      '13800138000',
    );
    // 微信预下单是远程调用，必须在落草稿之前
    expect(callOrder.indexOf('jsapi')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('jsapi')).toBeLessThan(
      callOrder.indexOf('createDraft'),
    );
  });

  it('到期闸门与上下文解析并行，且闸门异常优先', async () => {
    let releaseContext: () => void = () => {};
    const contextGate = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    downgradeService.assertStoreCanOrder.mockImplementation(async () => {
      await withTimeout(contextGate, '闸门未与上下文解析并行：上下文未被启动');
      return undefined;
    });
    contextService.resolveCreateServiceOrderContext.mockImplementation(() => {
      releaseContext();
      return Promise.resolve(ORDER_CONTEXT);
    });

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).resolves.toBeDefined();

    downgradeService.assertStoreCanOrder.mockRejectedValue(
      new Error('store-blocked'),
    );
    contextService.resolveCreateServiceOrderContext.mockRejectedValue(
      new Error('product-missing'),
    );

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).rejects.toThrow('store-blocked');
  });

  it('新客额度闸门与活动快照预加载并行，额度异常优先', async () => {
    let releasePreload: () => void = () => {};
    const preloadGate = new Promise<void>((resolve) => {
      releasePreload = resolve;
    });
    quotaService.assertAvailableForOrder.mockImplementation(async () => {
      await withTimeout(preloadGate, '额度闸门未与活动快照并行：快照未被启动');
      return true;
    });
    promotionsService.preloadPricingContext.mockImplementation(() => {
      releasePreload();
      return Promise.resolve({ promotions: [], hasConsumption: false });
    });

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).resolves.toBeDefined();

    quotaService.assertAvailableForOrder.mockRejectedValue(
      new Error('quota-exhausted'),
    );
    promotionsService.preloadPricingContext.mockRejectedValue(
      new Error('promotion-broken'),
    );

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).rejects.toThrow('quota-exhausted');
  });

  it('算价分支与 openid 解析并行，算价异常优先且不落草稿', async () => {
    let releaseOpenid: () => void = () => {};
    const openidGate = new Promise<void>((resolve) => {
      releaseOpenid = resolve;
    });
    promotionsService.resolveOrderReduceFen.mockImplementation(async () => {
      await withTimeout(openidGate, 'openid 解析未与算价并行：openid 未被启动');
      return 500;
    });
    openidService.resolveOpenid.mockImplementation(() => {
      releaseOpenid();
      return Promise.resolve('openid-1');
    });

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).resolves.toBeDefined();

    promotionsService.resolveOrderReduceFen.mockRejectedValue(
      new Error('pricing-failed'),
    );
    openidService.resolveOpenid.mockRejectedValue(new Error('openid-failed'));

    await expect(
      service.createServiceOrder(currentContext, dto),
    ).rejects.toThrow('pricing-failed');
    expect(draftsService.createDraft).toHaveBeenCalledTimes(1);
  });

  it('测试模式：不解析 openid、不预下单，草稿不带支付参数', async () => {
    paymentModeService.isManualConfirmPaidAllowed.mockResolvedValue(true);

    await service.createServiceOrder(currentContext, dto);

    expect(openidService.resolveOpenid).not.toHaveBeenCalled();
    expect(jsapiService.createJsapiPaymentParams).not.toHaveBeenCalled();
    expect(draftsService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ paymentParams: undefined }),
    );
  });

  it('幂等命中：复用上一笔草稿，不再建单也不扣额度', async () => {
    idempotencyService.normalizeKey.mockReturnValue('key-1');
    idempotencyService.findOrderNo.mockResolvedValue('order-9');
    draftsService.getDraft.mockResolvedValue({ orderNo: 'order-9' });
    draftsService.toServiceOrderResponse.mockReturnValue({
      orderNo: 'order-9',
    });

    const result = await service.createServiceOrder(
      currentContext,
      dto,
      'key-1',
    );

    expect(result).toEqual({ orderNo: 'order-9', reused: true });
    expect(draftsService.createDraft).not.toHaveBeenCalled();
    expect(quotaService.consumeForOrder).not.toHaveBeenCalled();
  });

  it('建单失败：清草稿并释放幂等键，错误原样抛出', async () => {
    idempotencyService.normalizeKey.mockReturnValue('key-2');
    idempotencyService.findOrderNo.mockResolvedValue(null);
    idempotencyService.reserve.mockResolvedValue(null);
    idempotencyService.release.mockResolvedValue(undefined);
    draftsService.createDraft.mockRejectedValue(new Error('draft-broken'));

    await expect(
      service.createServiceOrder(currentContext, dto, 'key-2'),
    ).rejects.toThrow('draft-broken');

    expect(draftsService.deleteDraft).toHaveBeenCalledTimes(1);
    expect(idempotencyService.release).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'key-2', userId: 201 }),
    );
  });
});
