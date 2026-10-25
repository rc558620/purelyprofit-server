import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { PlatformMembershipActivationService } from './platform-membership-activation.service';
import { PlatformMembershipPaymentService } from './platform-membership-payment.service';
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
import { NewCustomerQuotaService } from '../new-customer-quota/new-customer-quota.service';

/**
 * 会员真实支付链路测试：覆盖资金安全的关键分支。
 *
 * - 真实模式下单只落「待支付订单 + 支付单」，**不扣积分与纯利豆**；
 * - 生效发生在支付回调里，重复回调不得重复开通；
 * - 回调金额与落单金额不一致时必须拒绝生效。
 */

const STORE_ID = 18;
const USER_ID = 100;
const PROFILE_ID = 3;
const PLAN_PRICE_FEN = 39800;
const ORDER_NO = 'PM20260101000000ABCD';

interface PrismaMockShape {
  $transaction: jest.Mock;
  membershipPlanSetting: { findMany: jest.Mock; upsert: jest.Mock };
  storeMembershipProfile: { upsert: jest.Mock; update: jest.Mock };
  storePartner: { findFirst: jest.Mock; updateMany: jest.Mock };
  storePartnerBeanLog: { create: jest.Mock };
  storeMembershipPointsLog: { create: jest.Mock };
  storeMembershipOrder: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
  };
  platformPaymentOrder: { findUnique: jest.Mock };
}

let prismaMock: PrismaMockShape;

const buildPrismaMock = (): PrismaMockShape => {
  const mock = {
    membershipPlanSetting: {
      // 档位目录按固定顺序遍历，缺失档位会让 requirePlan 取不到配置
      findMany: jest.fn(() =>
        Promise.resolve(
          (
            [
              ['monthly', 9800, 1],
              ['quarterly', 26800, 3],
              ['yearly', PLAN_PRICE_FEN, 12],
              ['lifetime', 99800, 24],
            ] as const
          ).map(([planId, price, durationMonths]) => ({
            planId,
            planName: `${planId}会员`,
            price,
            originalPrice: null,
            durationMonths,
            validDays: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          })),
        ),
      ),
      // 默认档位回写：loadMembershipPlanSettings 会为每个缺失档位补一行
      upsert: jest.fn(() => Promise.resolve(undefined)),
    },
    storeMembershipProfile: {
      upsert: jest.fn(() =>
        Promise.resolve({
          id: PROFILE_ID,
          storeId: STORE_ID,
          currentPlanId: null,
          previousPlanId: null,
          startsAt: null,
          expiresAt: null,
          totalPoints: 0,
          availablePoints: 0,
        }),
      ),
      update: jest.fn(() =>
        Promise.resolve({
          id: PROFILE_ID,
          storeId: STORE_ID,
          currentPlanId: 'yearly',
          previousPlanId: null,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          totalPoints: 0,
          availablePoints: 0,
        }),
      ),
    },
    storePartner: {
      findFirst: jest.fn(() =>
        Promise.resolve({ id: 11, storeId: STORE_ID, beanBalance: 50 }),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    storePartnerBeanLog: { create: jest.fn(() => Promise.resolve(undefined)) },
    storeMembershipPointsLog: {
      create: jest.fn(() => Promise.resolve(undefined)),
    },
    storeMembershipOrder: {
      create: jest.fn(() => Promise.resolve({ id: 31 })),
      findFirst: jest.fn(() =>
        Promise.resolve({ id: 31, storeId: STORE_ID, amount: PLAN_PRICE_FEN }),
      ),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 31,
          storeId: STORE_ID,
          profileId: PROFILE_ID,
          planId: 'yearly',
          planName: '年度会员',
          originalAmount: PLAN_PRICE_FEN,
          amount: PLAN_PRICE_FEN,
          pointsUsed: 0,
          beansUsed: 0,
          status: 'pending',
          paymentChannel: 'wechat',
          paymentOrderId: ORDER_NO,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ),
      update: jest.fn(() => Promise.resolve({ id: 31 })),
      // 默认没有待支付订单占用积分
      aggregate: jest.fn(() => Promise.resolve({ _sum: { pointsUsed: 0 } })),
    },
    platformPaymentOrder: {
      // 推广奖励归属人只认支付单发起人，桩里必须能取到
      findUnique: jest.fn(() => Promise.resolve({ operatorUserId: USER_ID })),
    },
  } as unknown as Omit<PrismaMockShape, '$transaction'>;

  return {
    ...mock,
    // 事务客户端就是桩本身：覆盖「置 paid + 业务生效」在同一事务内的语义
    $transaction: jest.fn(
      (callback: (tx: PrismaMockShape) => Promise<unknown>) =>
        callback(mock as unknown as PrismaMockShape),
    ),
  } as PrismaMockShape;
};

describe('PlatformMembershipPaymentService', () => {
  /** 支付单服务用桩隔离：本文件聚焦会员权益与资金安全，不测支付单状态机本身 */
  let paymentOrderService: {
    createOrder: jest.Mock;
    attachCodeUrl: jest.Mock;
    markFailed: jest.Mock;
    markPaid: jest.Mock;
    settleWithBusinessWrite: jest.Mock;
  };

  const buildService = async (overrides?: {
    notifyUrl?: string;
    /** 模拟「置 paid 未命中」（重复回调）：跳过业务写入并返回 null */
    skipSettle?: boolean;
  }): Promise<PlatformMembershipPaymentService> => {
    paymentOrderService = {
      createOrder: jest.fn(() =>
        Promise.resolve({
          orderNo: ORDER_NO,
          bizType: 'membership',
          bizOrderId: null,
          storeId: STORE_ID,
          amountFen: PLAN_PRICE_FEN,
          payMode: 'live',
          status: 'pending',
          codeUrl: null,
          expiresAt: new Date('2026-01-01T00:15:00.000Z'),
        }),
      ),
      attachCodeUrl: jest.fn(() => Promise.resolve(undefined)),
      markFailed: jest.fn(() => Promise.resolve(undefined)),
      markPaid: jest.fn(() => Promise.resolve(true)),
      // 默认真实执行业务写入：金额校验与生效逻辑都在 write 回调里，
      // 桩掉它就等于没测到资金安全分支
      settleWithBusinessWrite: jest.fn(
        (
          _orderNo: string,
          _transactionId: string,
          write: (tx: unknown) => Promise<unknown>,
        ) =>
          overrides?.skipSettle ? Promise.resolve(null) : write(prismaMock),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformMembershipPaymentService,
        PlatformMembershipActivationService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'profit.wechatPayNotifyUrl'
                ? (overrides?.notifyUrl ?? '')
                : undefined,
            ),
          },
        },
        {
          provide: StoreMembershipLockedPriceService,
          useValue: {
            loadRenewalPricingContext: jest.fn(() =>
              Promise.resolve({ subAccountFeatureOwned: false }),
            ),
            resolvePlanPrice: jest.fn(() => ({ price: PLAN_PRICE_FEN })),
            lockPriceOnFirstDeal: jest.fn(() => Promise.resolve(undefined)),
          },
        },
        {
          provide: PlatformMembershipPromoService,
          useValue: {
            tryAwardPromoReward: jest.fn(() => Promise.resolve(undefined)),
          },
        },
        {
          provide: CacheInvalidatorService,
          useValue: {
            invalidateMembershipDerived: jest.fn(() =>
              Promise.resolve(undefined),
            ),
          },
        },
        { provide: PlatformPaymentOrderService, useValue: paymentOrderService },
        {
          provide: PlatformWechatNativeService,
          useValue: {
            createNativeOrder: jest.fn(() =>
              Promise.resolve({ codeUrl: 'weixin://wxpay/x' }),
            ),
          },
        },
        {
          // 二维码出图与支付无关：用桩隔离，避免测试依赖图形库
          provide: PlatformPaymentQrCodeService,
          useValue: {
            renderPaymentQrCode: jest.fn(() =>
              Promise.resolve('data:image/png;base64,MOCK'),
            ),
          },
        },
        {
          provide: NewCustomerQuotaService,
          useValue: { grantByPlan: jest.fn(() => Promise.resolve(undefined)) },
        },
      ],
    }).compile();

    return moduleRef.get(PlatformMembershipPaymentService);
  };

  beforeEach(() => {
    prismaMock = buildPrismaMock();
  });

  it('真实模式下单返回二维码，且落的是待支付订单', async () => {
    const service = await buildService({
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    });

    const result = await service.createMembershipPaymentOrder(
      USER_ID,
      STORE_ID,
      { planId: 'yearly' },
    );

    expect(result.mode).toBe('live');
    expect(result.orderNo).toBe(ORDER_NO);
    expect(result.codeUrl).toBe('weixin://wxpay/x');
    expect(result.amountFen).toBe(PLAN_PRICE_FEN);

    const createdOrder =
      prismaMock.storeMembershipOrder.create.mock.calls[0][0];
    expect(createdOrder.data.status).toBe('pending');
    expect(createdOrder.data.paymentOrderId).toBe(ORDER_NO);
  });

  it('下单时不扣纯利豆也不改会员档期（扣减发生在支付回调里）', async () => {
    const service = await buildService({
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    });

    await service.createMembershipPaymentOrder(USER_ID, STORE_ID, {
      planId: 'yearly',
      useBeans: 10,
    });

    expect(prismaMock.storePartner.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.storeMembershipProfile.update).not.toHaveBeenCalled();
  });

  it('纯利豆余额为 0 时下单直接拒绝，不产生待支付订单', async () => {
    prismaMock.storePartner.findFirst.mockResolvedValue({
      id: 11,
      storeId: STORE_ID,
      beanBalance: 0,
    });
    const service = await buildService({
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    });

    await expect(
      service.createMembershipPaymentOrder(USER_ID, STORE_ID, {
        planId: 'yearly',
        useBeans: 10,
      }),
      // 抵扣额度以余额为准（actualBeansUsed 会被余额夹住为 0），
      // 因此这里表现为「无可抵扣纯利豆」而不是「余额不足」
    ).rejects.toThrow(/无可抵扣纯利豆/);

    expect(prismaMock.storeMembershipOrder.create).not.toHaveBeenCalled();
  });

  it('回调地址未配置时拒绝下单，并留下 failed 支付单而非悬空 pending', async () => {
    const service = await buildService();

    await expect(
      service.createMembershipPaymentOrder(USER_ID, STORE_ID, {
        planId: 'yearly',
      }),
    ).rejects.toThrow(/PROFIT_WECHAT_PAY_NOTIFY_URL/);

    expect(paymentOrderService.markFailed).toHaveBeenCalledWith(ORDER_NO);
  });

  it('支付回调生效：订单置 paid 且会员档期落库', async () => {
    const service = await buildService();

    await service.activateByPaymentOrderNo({
      paymentOrderNo: ORDER_NO,
      transactionId: 'wx-tx-1',
      amountFen: PLAN_PRICE_FEN,
    });

    expect(prismaMock.storeMembershipProfile.update).toHaveBeenCalled();
    expect(prismaMock.storeMembershipOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'paid' }),
      }),
    );
  });

  it('重复回调不重复生效（支付单未命中即跳过）', async () => {
    const service = await buildService({ skipSettle: true });

    await service.activateByPaymentOrderNo({
      paymentOrderNo: ORDER_NO,
      transactionId: 'wx-tx-1',
      amountFen: PLAN_PRICE_FEN,
    });

    expect(prismaMock.storeMembershipProfile.update).not.toHaveBeenCalled();
    expect(prismaMock.storeMembershipOrder.update).not.toHaveBeenCalled();
  });

  it('回调金额与落单金额不一致时拒绝生效', async () => {
    const service = await buildService();
    prismaMock.storeMembershipOrder.findFirst.mockResolvedValue({
      id: 31,
      storeId: STORE_ID,
      amount: PLAN_PRICE_FEN,
    });

    await expect(
      service.activateByPaymentOrderNo({
        paymentOrderNo: ORDER_NO,
        transactionId: 'wx-tx-1',
        amountFen: 100,
      }),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.storeMembershipProfile.update).not.toHaveBeenCalled();
  });
});
