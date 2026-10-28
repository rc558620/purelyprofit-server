import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';

/**
 * 平台支付单状态机测试：覆盖资金安全最关键的几条分支。
 *
 * - 幂等：重复回调靠条件更新 + 影响行数判定，绝不先读后写；
 * - 拆分：钱先落定（markPaid 独立提交），业务入账失败不得把支付单回滚回 pending；
 * - 关单：过期单先问微信侧，关单瞬间被回调置 paid 时必须回真实状态；
 * - 归属：跨门店查单一律按「不存在」处理；
 * - 对账：列表强制带门店条件且不返回二维码。
 */

const STORE_ID = 18;
const OTHER_STORE_ID = 19;
const ORDER_NO = 'PM20261026120000ABCDEF123456';

interface PaymentOrderTableMock {
  create: jest.Mock;
  updateMany: jest.Mock;
  update: jest.Mock;
  findUnique: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
}

interface TxMock {
  platformPaymentOrder: PaymentOrderTableMock;
  $queryRaw: jest.Mock;
}

const createTableMock = (): PaymentOrderTableMock => ({
  create: jest.fn(),
  updateMany: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
});

const createTxMock = (): TxMock => ({
  platformPaymentOrder: createTableMock(),
  $queryRaw: jest.fn(() => Promise.resolve([])),
});

let prismaMock: {
  platformPaymentOrder: PaymentOrderTableMock;
  $transaction: jest.Mock;
};
let txMock: TxMock;
let wechatMock: { closeNativeOrder: jest.Mock };
let realtimeMock: {
  publishPaid: jest.Mock;
  publishFailed: jest.Mock;
  publishClosed: jest.Mock;
};
let service: PlatformPaymentOrderService;

beforeEach(async () => {
  txMock = createTxMock();
  prismaMock = {
    platformPaymentOrder: createTableMock(),
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(txMock);
      }
      return Promise.resolve(arg);
    }),
  };
  wechatMock = { closeNativeOrder: jest.fn() };
  realtimeMock = {
    publishPaid: jest.fn(),
    publishFailed: jest.fn(),
    publishClosed: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PlatformPaymentOrderService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: PlatformWechatNativeService, useValue: wechatMock },
      { provide: PlatformPaymentRealtimeService, useValue: realtimeMock },
    ],
  }).compile();

  service = module.get<PlatformPaymentOrderService>(
    PlatformPaymentOrderService,
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('markPaid 幂等', () => {
  it('影响行数为 0 时返回 false，调用方据此跳过重复入账', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.markPaid({ orderNo: ORDER_NO, transactionId: 'wx-1' }),
    ).resolves.toBe(false);
  });

  it('用带状态条件的 updateMany，而不是先读状态再写', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.markPaid({ orderNo: ORDER_NO, transactionId: 'wx-1' });

    expect(prismaMock.platformPaymentOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderNo: ORDER_NO, status: { not: 'paid' } },
      }),
    );
    expect(prismaMock.platformPaymentOrder.findUnique).not.toHaveBeenCalled();
  });

  it('closed / failed 单能被回调推进为 paid（关单与付款竞态可自愈）', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.markPaid({ orderNo: ORDER_NO, transactionId: 'wx-1' }),
    ).resolves.toBe(true);

    const call = prismaMock.platformPaymentOrder.updateMany.mock.calls[0][0];
    // 条件只排除 paid，意味着 closed / failed 都可以被真实付款纠正
    expect(call.where.status).toEqual({ not: 'paid' });
  });
});

describe('settleWithBusinessWrite 拆分事务', () => {
  it('先落定支付单，再执行业务写入', async () => {
    const steps: string[] = [];
    prismaMock.platformPaymentOrder.updateMany.mockImplementation(() => {
      steps.push('markPaid');
      return Promise.resolve({ count: 1 });
    });

    const result = await service.settleWithBusinessWrite(
      ORDER_NO,
      'wx-1',
      // 不标 async：回调本身没有 await，用 Promise.resolve 直接返回，
      // 既满足 write 的 Promise 签名，也不触发 require-await
      (tx: unknown) => {
        steps.push('write');
        expect(tx).toBe(txMock);
        return Promise.resolve('ok');
      },
    );

    expect(result).toBe('ok');
    expect(steps).toEqual(['markPaid', 'write']);
  });

  it('业务入账失败时抛错，但 markPaid 已在独立连接上提交，不会被回滚', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.settleWithBusinessWrite(ORDER_NO, 'wx-1', () =>
        Promise.reject(new Error('纯利豆不足')),
      ),
    ).rejects.toThrow('纯利豆不足');

    // markPaid 走 this.prisma（非业务事务），因此这里能观察到它确实执行过
    expect(prismaMock.platformPaymentOrder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('重复回调时仍补一次业务入账，由 write 内部幂等兜底', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 0 });
    const write = jest.fn(() => Promise.resolve(null));

    await expect(
      service.settleWithBusinessWrite(ORDER_NO, 'wx-1', write),
    ).resolves.toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('入账前先锁支付单行，串行化并发回调与补偿', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.settleWithBusinessWrite(ORDER_NO, 'wx-1', () =>
      Promise.resolve('ok'),
    );

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('getStatus 归属校验与惰性关单', () => {
  const baseOrder = (
    overrides: Partial<{
      storeId: number;
      status: string;
      paidAt: Date | null;
      expiresAt: Date;
      codeUrl: string | null;
      payMode: string;
    }> = {},
  ) => ({
    storeId: STORE_ID,
    status: 'pending',
    paidAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
    payMode: 'live',
    ...overrides,
  });

  it('门店不匹配按「不存在」处理，避免枚举他人支付单', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(
      baseOrder({ storeId: OTHER_STORE_ID }),
    );

    await expect(service.getStatus(ORDER_NO, STORE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('已支付直接返回 paid，不再触发关单', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(
      baseOrder({ status: 'paid', paidAt: new Date('2026-10-26T12:03:00Z') }),
    );

    const result = await service.getStatus(ORDER_NO, STORE_ID);

    expect(result.status).toBe('paid');
    expect(prismaMock.platformPaymentOrder.updateMany).not.toHaveBeenCalled();
    expect(wechatMock.closeNativeOrder).not.toHaveBeenCalled();
  });

  it('主动关单：未过期的 pending 单也会先关微信侧，再置 closed 并推送', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(baseOrder());
    wechatMock.closeNativeOrder.mockResolvedValue('closed');
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.closeOrder(ORDER_NO, STORE_ID)).resolves.toEqual({
      status: 'closed',
      paidAt: null,
    });
    // 微信侧必须先关：否则二维码在有效期内仍可被扫付款（误扣）
    expect(wechatMock.closeNativeOrder).toHaveBeenCalled();
    expect(realtimeMock.publishClosed).toHaveBeenCalledWith(ORDER_NO);
  });

  it('主动关单时微信侧已支付：不关本地单，回真实状态且不推 closed', async () => {
    prismaMock.platformPaymentOrder.findUnique
      .mockResolvedValueOnce(baseOrder())
      .mockResolvedValueOnce({
        status: 'paid',
        paidAt: new Date('2026-10-26T12:03:00Z'),
      });
    wechatMock.closeNativeOrder.mockResolvedValue('paid');

    const result = await service.closeOrder(ORDER_NO, STORE_ID);

    expect(result.status).toBe('paid');
    expect(prismaMock.platformPaymentOrder.updateMany).not.toHaveBeenCalled();
    expect(realtimeMock.publishClosed).not.toHaveBeenCalled();
  });

  it('测试单过期不询问微信，直接置 closed', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(
      baseOrder({
        payMode: 'test',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.getStatus(ORDER_NO, STORE_ID)).resolves.toEqual({
      status: 'closed',
      paidAt: null,
    });
    expect(wechatMock.closeNativeOrder).not.toHaveBeenCalled();
  });

  it('真实单过期但微信侧已支付时保持 pending，等回调来改状态', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(
      baseOrder({ expiresAt: new Date(Date.now() - 1000) }),
    );
    wechatMock.closeNativeOrder.mockResolvedValue('paid');

    await expect(service.getStatus(ORDER_NO, STORE_ID)).resolves.toEqual({
      status: 'pending',
      paidAt: null,
    });
    // 微信侧已付款时绝不能把本地单关掉
    expect(prismaMock.platformPaymentOrder.updateMany).not.toHaveBeenCalled();
  });

  it('关单瞬间被回调置 paid：回真实状态而不是 closed', async () => {
    prismaMock.platformPaymentOrder.findUnique
      .mockResolvedValueOnce(
        baseOrder({ expiresAt: new Date(Date.now() - 1000) }),
      )
      .mockResolvedValueOnce({
        status: 'paid',
        paidAt: new Date('2026-10-26T12:03:00Z'),
      });
    wechatMock.closeNativeOrder.mockResolvedValue('closed');
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.getStatus(ORDER_NO, STORE_ID);

    expect(result.status).toBe('paid');
    expect(result.paidAt).toEqual(new Date('2026-10-26T12:03:00Z'));
  });

  it('微信关单调用失败时保持 pending，绝不凭「结果未知」关本地单', async () => {
    prismaMock.platformPaymentOrder.findUnique.mockResolvedValue(
      baseOrder({ expiresAt: new Date(Date.now() - 1000) }),
    );
    wechatMock.closeNativeOrder.mockRejectedValue(
      new Error('微信支付服务暂时不可用'),
    );

    await expect(service.getStatus(ORDER_NO, STORE_ID)).resolves.toEqual({
      status: 'pending',
      paidAt: null,
    });
    // 关单结果未知 ≠ 未支付：强行关单会让前端提示超时，而用户在微信侧仍可扫码付款
    expect(prismaMock.platformPaymentOrder.updateMany).not.toHaveBeenCalled();
  });

  it('closeWechatOrderQuietly 吞掉关单异常，不覆盖调用方原始错误', async () => {
    wechatMock.closeNativeOrder.mockRejectedValue(new Error('网络异常'));

    await expect(
      service.closeWechatOrderQuietly(ORDER_NO, 'membership'),
    ).resolves.toBeUndefined();
    expect(wechatMock.closeNativeOrder).toHaveBeenCalledWith(
      ORDER_NO,
      'membership',
    );
  });
});

describe('markClosed 幂等关单', () => {
  it('命中 pending 行时置 closed 并推送 payment.closed', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.markClosed(ORDER_NO)).resolves.toBe(true);

    expect(prismaMock.platformPaymentOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: ORDER_NO, status: 'pending' },
      data: { status: 'closed' },
    });
    expect(realtimeMock.publishClosed).toHaveBeenCalledWith(ORDER_NO);
  });

  it('已被回调置 paid 时返回 false，不推送关闭事件', async () => {
    prismaMock.platformPaymentOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markClosed(ORDER_NO)).resolves.toBe(false);

    expect(realtimeMock.publishClosed).not.toHaveBeenCalled();
  });
});
