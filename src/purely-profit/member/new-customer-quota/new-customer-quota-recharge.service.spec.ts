import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { PlatformPaymentQrCodeService } from '../../payments/platform-payment-qrcode.service';
import { PlatformPaymentRealtimeService } from '../../payments/platform-payment-realtime.service';
import { ProfitPaymentModeService } from '../../payments/profit-payment-mode.service';
import { RECHARGE_TIER_AMOUNT_FEN } from './new-customer-quota.constants';
import { NewCustomerQuotaRechargeService } from './new-customer-quota-recharge.service';

/**
 * 下单用的档位金额：**从常量取**而不是写死 1000 分。
 * 常量在联调微信支付期间被临时降档（0.1/0.2/0.3 元），写死会让用例集体失效；
 * 断言「每一档都能下单」本就不该依赖具体金额。
 */
const TIER_FEN = RECHARGE_TIER_AMOUNT_FEN[0];

/**
 * 额度充值支付测试：覆盖资金安全的关键分支。
 *
 * - 测试模式：直接入账且仍落一条 paid 支付单（对账口径与真实单一致）
 * - 真实模式：换 codeUrl，前端凭 orderNo 轮询
 * - 回调金额与落单金额不一致时必须拒绝入账（防篡改 / 串单）
 * - 重复回调不得重复加额度（幂等）
 */

interface PrismaMock {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  platformPaymentOrder: {
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  storeMembershipProfile: {
    upsert: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  storeNewCustomerQuotaLog: {
    create: jest.Mock;
    aggregate: jest.Mock;
    findFirst: jest.Mock;
  };
}

let prismaMock: PrismaMock;

/** 显式建桩：只覆盖额度入账与支付单实际用到的查询，避免 Proxy 让 Nest 的装配卡死 */
const buildPrismaMock = (): PrismaMock => {
  const mock = {
    platformPaymentOrder: {
      // 落单回显：把 data 原样返回，让「单号 / 金额 / 过期时间」能被断言到
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, status: 'pending' }),
      ),
      update: jest.fn(() => Promise.resolve(undefined)),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      findUnique: jest.fn(),
      // 测试模式防重窗口：默认查不到近期同档位测试单
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    storeMembershipProfile: {
      upsert: jest.fn(() => Promise.resolve(undefined)),
      update: jest.fn(() => Promise.resolve({ newCustomerQuota: 333 })),
      findUnique: jest.fn(() =>
        Promise.resolve({ newCustomerQuota: 333, newCustomerQuotaConsumed: 0 }),
      ),
    },
    storeNewCustomerQuotaLog: {
      create: jest.fn(() => Promise.resolve(undefined)),
      aggregate: jest.fn(() => Promise.resolve({ _sum: { changeAmount: 0 } })),
      // 幂等判定：默认该支付单尚未入账
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    // 入账前会锁支付单行，桩掉原始查询即可
    $queryRaw: jest.fn(() => Promise.resolve([])),
  } as unknown as Omit<PrismaMock, '$transaction'>;

  return {
    ...mock,
    // 事务客户端就是桩本身：保证「置 paid + 业务入账」在同一事务里的语义被覆盖到
    $transaction: jest.fn((callback: (tx: PrismaMock) => Promise<unknown>) =>
      callback(mock as unknown as PrismaMock),
    ),
  } as PrismaMock;
};

describe('NewCustomerQuotaRechargeService', () => {
  /** 微信下单 / 关单桩：用例需要断言关单是否被调用 */
  let wechatMock: {
    createNativeOrder: jest.Mock;
    closeNativeOrder: jest.Mock;
  };

  const buildService = async (overrides: {
    skipPayment: boolean;
    notifyUrl?: string;
    nativeImpl?: () => Promise<{ codeUrl: string }>;
    /** 模拟二维码出图失败 */
    qrImpl?: () => Promise<string>;
  }): Promise<NewCustomerQuotaRechargeService> => {
    wechatMock = {
      createNativeOrder: jest.fn(
        overrides.nativeImpl ??
          (() => Promise.resolve({ codeUrl: 'weixin://wxpay/x' })),
      ),
      // 超时惰性关单 / 出图失败关单都会调用它
      closeNativeOrder: jest.fn(() => Promise.resolve('closed')),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NewCustomerQuotaRechargeService,
        PlatformPaymentOrderService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'profit.wechatPayNotifyUrl'
                ? (overrides.notifyUrl ?? '')
                : undefined,
            ),
          },
        },
        {
          provide: ProfitPaymentModeService,
          useValue: {
            isSkipPaymentAllowed: jest.fn(() =>
              Promise.resolve(overrides.skipPayment),
            ),
          },
        },
        {
          provide: PlatformWechatNativeService,
          useValue: wechatMock,
        },
        {
          // 支付单关闭后的实时推送：与额度充值断言无关，用桩隔离
          provide: PlatformPaymentRealtimeService,
          useValue: { publishClosed: jest.fn(), publishPaid: jest.fn() },
        },
        {
          // 二维码出图与支付无关：用桩隔离，避免测试依赖图形库
          provide: PlatformPaymentQrCodeService,
          useValue: {
            renderPaymentQrCode: jest.fn(
              overrides.qrImpl ??
                (() => Promise.resolve('data:image/png;base64,MOCK')),
            ),
          },
        },
      ],
    }).compile();

    return moduleRef.get(NewCustomerQuotaRechargeService);
  };

  beforeEach(() => {
    prismaMock = buildPrismaMock();
  });

  it('测试模式直接入账，并落一条 paid 支付单保证对账口径一致', async () => {
    const service = await buildService({ skipPayment: true });

    const result = await service.createRechargeOrder({
      storeId: 7,
      operatorUserId: 100,
      amountFen: TIER_FEN,
    });

    expect(result.mode).toBe('test');
    expect(result.orderNo).toMatch(/^PQ/);
    expect(result.overview).toBeDefined();
    // 入账动作必须发生：写档案 + 写流水
    expect(
      (prismaMock as { storeMembershipProfile: { update: jest.Mock } })
        .storeMembershipProfile.update,
    ).toHaveBeenCalled();
  });

  it('真实模式返回二维码与过期时间，供前端轮询', async () => {
    const service = await buildService({
      skipPayment: false,
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    });

    const result = await service.createRechargeOrder({
      storeId: 7,
      operatorUserId: 100,
      amountFen: TIER_FEN,
    });

    expect(result.mode).toBe('live');
    expect(result.codeUrl).toBe('weixin://wxpay/x');
    expect(result.amountFen).toBe(TIER_FEN);
    expect(result.expiresAt).toBeInstanceOf(Date);
    // 真实模式绝不能同步入账：额度只能由回调发放
    expect(
      (prismaMock as { storeMembershipProfile: { update: jest.Mock } })
        .storeMembershipProfile.update,
    ).not.toHaveBeenCalled();
  });

  it('二维码出图失败：必须关掉已创建的微信单，不能只把本地单置失败', async () => {
    const service = await buildService({
      skipPayment: false,
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
      qrImpl: () => Promise.reject(new Error('出图失败')),
    });

    await expect(
      service.createRechargeOrder({
        storeId: 7,
        operatorUserId: 100,
        amountFen: TIER_FEN,
      }),
    ).rejects.toThrow('出图失败');

    // 微信侧二维码 2 小时有效：只置本地 failed 会留下悬空可支付单
    expect(wechatMock.closeNativeOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PQ/),
      'new_customer_quota',
    );

    const updateMany = (
      prismaMock as { platformPaymentOrder: { updateMany: jest.Mock } }
    ).platformPaymentOrder.updateMany;
    expect(
      updateMany.mock.calls.some(
        (call: { data?: { status?: string } }[]) =>
          call[0]?.data?.status === 'failed',
      ),
    ).toBe(true);
  });

  it('回调地址未配置时拒绝下单，且支付单置 failed', async () => {
    const service = await buildService({ skipPayment: false });

    await expect(
      service.createRechargeOrder({
        storeId: 7,
        operatorUserId: 100,
        amountFen: TIER_FEN,
      }),
    ).rejects.toThrow(/PROFIT_WECHAT_PAY_NOTIFY_URL/);

    const updateMany = (
      prismaMock as { platformPaymentOrder: { updateMany: jest.Mock } }
    ).platformPaymentOrder.updateMany;
    expect(
      updateMany.mock.calls.some(
        (call: { data?: { status?: string } }[]) =>
          call[0]?.data?.status === 'failed',
      ),
    ).toBe(true);
  });

  it('回调金额与落单金额不一致时拒绝入账', async () => {
    const service = await buildService({ skipPayment: true });
    (
      prismaMock as { platformPaymentOrder: { findUnique: jest.Mock } }
    ).platformPaymentOrder.findUnique.mockResolvedValue({
      orderNo: 'PQ1',
      bizType: 'new_customer_quota',
      bizOrderId: null,
      storeId: 7,
      operatorUserId: 100,
      amountFen: 1000,
      payMode: 'live',
      status: 'pending',
    });

    await expect(
      service.settleByOrderNo({
        orderNo: 'PQ1',
        transactionId: 'wx-tx-1',
        amountFen: 5000,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('重复回调靠流水单号幂等，不重复加额度', async () => {
    const service = await buildService({ skipPayment: true });
    const paymentOrder = prismaMock as {
      platformPaymentOrder: { findUnique: jest.Mock; updateMany: jest.Mock };
    };
    paymentOrder.platformPaymentOrder.findUnique.mockResolvedValue({
      orderNo: 'PQ1',
      bizType: 'new_customer_quota',
      bizOrderId: null,
      storeId: 7,
      operatorUserId: 100,
      amountFen: 1000,
      payMode: 'live',
      status: 'paid',
      transactionId: 'wx-tx-1',
    });
    // 支付单已被处理过：带状态条件的更新命中 0 行
    paymentOrder.platformPaymentOrder.updateMany.mockResolvedValue({
      count: 0,
    });
    // 该支付单的充值流水已存在：入账必须直接跳过，不能二次加额度
    prismaMock.storeNewCustomerQuotaLog.findFirst.mockResolvedValue({ id: 1 });

    await service.settleByOrderNo({
      orderNo: 'PQ1',
      transactionId: 'wx-tx-1',
      amountFen: 1000,
    });

    expect(
      (prismaMock as { storeMembershipProfile: { update: jest.Mock } })
        .storeMembershipProfile.update,
    ).not.toHaveBeenCalled();
    expect(prismaMock.storeNewCustomerQuotaLog.create).not.toHaveBeenCalled();
  });

  it('非档位金额直接拒绝，不产生支付单', async () => {
    const service = await buildService({ skipPayment: true });

    await expect(
      service.createRechargeOrder({
        storeId: 7,
        operatorUserId: 100,
        amountFen: 1234,
      }),
    ).rejects.toThrow(/档位/);
  });

  it('轮询校验门店归属：单号属于别家门店时按「不存在」拒绝', async () => {
    const service = await buildService({ skipPayment: true });
    (
      prismaMock as { platformPaymentOrder: { findUnique: jest.Mock } }
    ).platformPaymentOrder.findUnique.mockResolvedValue({
      orderNo: 'PQ1',
      bizType: 'new_customer_quota',
      bizOrderId: null,
      storeId: 99,
      operatorUserId: 100,
      amountFen: 1000,
      payMode: 'live',
      status: 'pending',
    });

    await expect(service.getRechargeStatus('PQ1', 7)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('轮询校验业务类型：非额度充值单按「不存在」拒绝', async () => {
    const service = await buildService({ skipPayment: true });
    (
      prismaMock as { platformPaymentOrder: { findUnique: jest.Mock } }
    ).platformPaymentOrder.findUnique.mockResolvedValue({
      orderNo: 'PM1',
      bizType: 'membership',
      bizOrderId: null,
      storeId: 7,
      operatorUserId: 100,
      amountFen: 9900,
      payMode: 'live',
      status: 'pending',
    });

    await expect(service.getRechargeStatus('PM1', 7)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('回调业务类型不匹配时拒绝入账', async () => {
    const service = await buildService({ skipPayment: true });
    (
      prismaMock as { platformPaymentOrder: { findUnique: jest.Mock } }
    ).platformPaymentOrder.findUnique.mockResolvedValue({
      orderNo: 'PM1',
      bizType: 'membership',
      bizOrderId: null,
      storeId: 7,
      operatorUserId: 100,
      amountFen: 1000,
      payMode: 'live',
      status: 'pending',
    });

    await expect(
      service.settleByOrderNo({
        orderNo: 'PM1',
        transactionId: 'wx-tx-1',
        amountFen: 1000,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('测试模式入账的流水描述标明未真实扣款，不冒充微信支付', async () => {
    const service = await buildService({ skipPayment: true });

    await service.createRechargeOrder({
      storeId: 7,
      operatorUserId: 100,
      amountFen: TIER_FEN,
    });

    const createLog = (
      prismaMock as { storeNewCustomerQuotaLog: { create: jest.Mock } }
    ).storeNewCustomerQuotaLog.create;
    const description = (
      createLog.mock.calls[0]?.[0] as { data?: { description?: string } }
    )?.data?.description;

    expect(description).toContain('测试模式');
    expect(description).not.toContain('微信支付');
  });
});
