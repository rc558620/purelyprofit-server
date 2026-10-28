import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformPaymentReconcileSettlementService } from './platform-payment-reconcile-settlement.service';
import { PlatformPaymentReconcileService } from './platform-payment-reconcile.service';

describe('PlatformPaymentReconcileService', () => {
  const MEMBERSHIP_ORDER_NO = 'PM202610290258172260A281A33C';
  const TRANSACTION_ID = '4200000000000000000000000000';

  /** 真实场景里的「微信侧已支付、本地仍 pending」订单 */
  const buildPending = (overrides: Record<string, unknown> = {}) => ({
    orderNo: MEMBERSHIP_ORDER_NO,
    bizType: 'membership',
    amountFen: 1,
    expiresAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  });

  const prismaService = {
    platformPaymentOrder: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const redisClient = {
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockResolvedValue(1),
  };
  const redisService = {
    getClient: jest.fn(() => redisClient),
    setIfAbsent: jest.fn().mockResolvedValue(true),
  };
  const alertService = { send: jest.fn().mockResolvedValue(undefined) };
  const nativeService = { queryNativeOrder: jest.fn() };
  const settlementService = {
    settlePaidOrder: jest.fn().mockResolvedValue(true),
    closeUnpaidOrder: jest.fn().mockResolvedValue(true),
    isUnpaid: jest.fn().mockReturnValue(true),
    isExpired: jest.fn().mockReturnValue(true),
  };

  const configValues: Record<string, number | boolean> = {
    'app.platformPaymentReconcileEnabled': true,
    'app.platformPaymentReconcileIntervalMs': 1_800_000,
    'app.platformPaymentReconcileBatchSize': 200,
    'app.platformPaymentReconcileMinPendingMinutes': 5,
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  let service: PlatformPaymentReconcileService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(1);
    redisService.getClient.mockReturnValue(redisClient);
    redisService.setIfAbsent.mockResolvedValue(true);
    alertService.send.mockResolvedValue(undefined);
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([]);
    nativeService.queryNativeOrder.mockResolvedValue(null);
    settlementService.settlePaidOrder.mockResolvedValue(true);
    settlementService.closeUnpaidOrder.mockResolvedValue(true);
    settlementService.isUnpaid.mockReturnValue(true);
    settlementService.isExpired.mockReturnValue(true);

    service = new PlatformPaymentReconcileService(
      prismaService as unknown as PrismaService,
      redisService as unknown as RedisService,
      configService as never,
      alertService as unknown as AlertService,
      nativeService as unknown as PlatformWechatNativeService,
      settlementService as unknown as PlatformPaymentReconcileSettlementService,
    );
  });

  it('只扫描 live 模式、挂起超过阈值且未超 24 小时的 pending 单', async () => {
    await service.reconcile();

    expect(prismaService.platformPaymentOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          payMode: 'live',
          createdAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      }),
    );
  });

  // 核心用例：回调丢了但钱已付 —— 必须交给执行层补入账，并计入 settled
  it('微信侧已支付时交执行层补入账并计入 settled', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    const snapshot = {
      tradeState: 'SUCCESS' as const,
      transactionId: TRANSACTION_ID,
      amountFen: 1,
      paidAt: new Date('2026-10-28T10:59:00.000Z'),
    };
    nativeService.queryNativeOrder.mockResolvedValue(snapshot);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 1,
      closed: 0,
      failed: 0,
    });

    expect(settlementService.settlePaidOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: MEMBERSHIP_ORDER_NO }),
      snapshot,
    );
    expect(settlementService.closeUnpaidOrder).not.toHaveBeenCalled();
  });

  it('执行层未命中已接入业务时不计入 settled', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    nativeService.queryNativeOrder.mockResolvedValue({
      tradeState: 'SUCCESS',
      transactionId: TRANSACTION_ID,
      amountFen: 1,
      paidAt: null,
    });
    settlementService.settlePaidOrder.mockResolvedValue(false);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 0,
      failed: 0,
    });
  });

  it('未支付且已过本地有效期时交执行层关单并计入 closed', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending({ expiresAt: new Date(Date.now() - 60 * 1000) }),
    ]);
    nativeService.queryNativeOrder.mockResolvedValue({
      tradeState: 'NOTPAY',
      transactionId: null,
      amountFen: 1,
      paidAt: null,
    });

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 1,
      failed: 0,
    });

    expect(settlementService.closeUnpaidOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: MEMBERSHIP_ORDER_NO }),
    );
  });

  it('未支付但本地尚未过期时不关单', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    nativeService.queryNativeOrder.mockResolvedValue({
      tradeState: 'NOTPAY',
      transactionId: null,
      amountFen: 1,
      paidAt: null,
    });
    settlementService.isExpired.mockReturnValue(false);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 0,
      failed: 0,
    });

    expect(settlementService.closeUnpaidOrder).not.toHaveBeenCalled();
  });

  it('微信侧查不到订单（ORDER_NOT_EXIST）时不关单', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    nativeService.queryNativeOrder.mockResolvedValue(null);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 0,
      failed: 0,
    });

    expect(settlementService.closeUnpaidOrder).not.toHaveBeenCalled();
    expect(alertService.send).not.toHaveBeenCalled();
  });

  it('查单异常时跳过本轮，不关单但计入 failed', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    nativeService.queryNativeOrder.mockRejectedValue(
      new Error('微信支付服务暂时不可用，请稍后重试'),
    );

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 0,
      failed: 1,
    });

    expect(settlementService.closeUnpaidOrder).not.toHaveBeenCalled();
  });

  it('并发重复对账只有一轮生效，入账不会被触发两次', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    nativeService.queryNativeOrder.mockResolvedValue({
      tradeState: 'SUCCESS',
      transactionId: TRANSACTION_ID,
      amountFen: 1,
      paidAt: new Date('2026-10-28T10:59:00.000Z'),
    });
    // 模拟多实例并发：Redis SET NX 只放行第一个，其余直接空转
    redisClient.set.mockResolvedValueOnce('OK').mockResolvedValue(null);

    const [first, second] = await Promise.all([
      service.reconcile(),
      service.reconcile(),
    ]);

    expect(first.settled).toBe(1);
    expect(second).toEqual({
      scanned: 0,
      settled: 0,
      closed: 0,
      failed: 0,
    });
    expect(settlementService.settlePaidOrder).toHaveBeenCalledTimes(1);
  });

  it('未抢到分布式锁时本轮不核对任何订单', async () => {
    redisClient.set.mockResolvedValue(null);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 0,
      settled: 0,
      closed: 0,
      failed: 0,
    });

    expect(prismaService.platformPaymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('未抢到查单名额（节流命中）时不发起微信查单', async () => {
    prismaService.platformPaymentOrder.findMany.mockResolvedValue([
      buildPending(),
    ]);
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(service.reconcile()).resolves.toEqual({
      scanned: 1,
      settled: 0,
      closed: 0,
      failed: 0,
    });

    expect(nativeService.queryNativeOrder).not.toHaveBeenCalled();
  });
});
