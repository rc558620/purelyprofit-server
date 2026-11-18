// 储值余额支付落账：与微信回调共用订单锁、先查单再改道、支付截止时间进原子条件
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubScanOrderingBalanceCheckoutService } from './club-scan-ordering-balance-checkout.service';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import { ClubScanOrderingWechatVerifyService } from './club-scan-ordering-wechat-verify.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

describe('ClubScanOrderingBalanceCheckoutService.createBalancePayment', () => {
  const user = { id: 7 } as AuthenticatedUser;
  const orderId = 1001;

  const payableOrder = {
    id: orderId,
    storeId: 11,
    orderNo: 'SO1001',
    payableAmount: 4800,
    version: 3,
    sessionId: 90,
    marketingSnapshot: { pointsUsed: 0, pointsDeductAmount: 0 },
    paymentExpiresAt: new Date(Date.now() + 10 * 60_000),
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'pending',
    pickupNumber: null,
    pickupNumberStatus: null,
    pickupCalledAt: null,
    pickupCompletedAt: null,
  };

  const tx = {
    // 扣余额内核用一条 RETURNING 的 UPDATE 原子完成（含余额下限判定）
    $queryRaw: jest.fn().mockResolvedValue([
      {
        total_spent: 4800,
        visit_count: 1,
        balance: 10_000,
        points: 30,
        tier: 'normal',
      },
    ]),
    marketingCustomer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    scanOrders: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    scanOrderPaymentAttempt: { create: jest.fn() },
    scanOrderBalanceTransaction: { create: jest.fn() },
    scanOrderStatusHistory: { create: jest.fn() },
  };

  const prisma = {
    scanOrders: { findFirst: jest.fn() },
    scanOrderPaymentAttempt: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const marketingCustomerService = {
    resolveActiveCustomer: jest.fn().mockResolvedValue({ id: 55 }),
    settlePaidOrder: jest.fn().mockResolvedValue({ earnedPoints: 3 }),
  };
  const pickupNumberService = {
    assignForPaidOrder: jest.fn(),
    formatPickupNumber: jest.fn(),
  };
  const cacheInvalidatorService = {
    invalidateMarketingCustomerDerived: jest.fn(),
  };
  const realtimeService = { publishOrderStatusChanged: jest.fn() };
  const paymentLockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };
  const wechatVerifyService = { verifyAndSettle: jest.fn() };

  let service: ClubScanOrderingBalanceCheckoutService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scanOrders.findFirst.mockResolvedValue({ ...payableOrder });
    prisma.scanOrderPaymentAttempt.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => unknown) => fn(tx),
    );
    tx.scanOrders.findUniqueOrThrow.mockResolvedValue({ ...payableOrder });
    paymentLockService.acquireLock.mockResolvedValue('lock-token');
    wechatVerifyService.verifyAndSettle.mockResolvedValue(false);

    service = new ClubScanOrderingBalanceCheckoutService(
      prisma as unknown as PrismaService,
      marketingCustomerService as unknown as ClubScanOrderingMarketingCustomerService,
      pickupNumberService as unknown as ScanOrderingPickupNumberService,
      cacheInvalidatorService as unknown as CacheInvalidatorService,
      realtimeService as unknown as ScanOrderingRealtimeService,
      paymentLockService as unknown as ClubPaymentLockService,
      wechatVerifyService as unknown as ClubScanOrderingWechatVerifyService,
    );
  });

  it('支付截止时间已过时拒绝扣款（后台关单任务延迟也不能扣）', async () => {
    prisma.scanOrders.findFirst.mockResolvedValue({
      ...payableOrder,
      paymentExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(
      service.createBalancePayment(user, orderId, 3),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(paymentLockService.acquireLock).not.toHaveBeenCalled();
  });

  it('客户端版本与库内不一致时拒绝扣款', async () => {
    await expect(
      service.createBalancePayment(user, orderId, 2),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // 回归：微信结果未知时直接改道余额，会让同一订单被收两次钱
  it('微信支付在途且查单确认已收款时拒绝改道余额', async () => {
    prisma.scanOrderPaymentAttempt.findFirst.mockResolvedValue({ id: 801 });
    wechatVerifyService.verifyAndSettle.mockResolvedValue(true);

    await expect(
      service.createBalancePayment(user, orderId, 3),
    ).rejects.toThrow('微信支付已完成');
    expect(wechatVerifyService.verifyAndSettle).toHaveBeenCalledWith(
      user.id,
      orderId,
      { force: true },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.marketingCustomer.updateMany).not.toHaveBeenCalled();
  });

  it('微信在途但查单确认未收款时放行余额落账', async () => {
    prisma.scanOrderPaymentAttempt.findFirst.mockResolvedValue({ id: 801 });

    await service.createBalancePayment(user, orderId, 3);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 余额在同一事务内条件扣减（balance >= 扣款额写进 SQL）
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('落账条件包含支付截止时间（原子条件兜住过期订单）', async () => {
    await service.createBalancePayment(user, orderId, 3);

    expect(tx.scanOrders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: orderId,
          version: 3,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          OR: [
            { paymentExpiresAt: null },
            { paymentExpiresAt: { gt: expect.any(Date) } },
          ],
        }),
      }),
    );
  });

  // 回归：并发下被微信回调抢先落账时，余额事务必须整体回滚
  it('订单已被并发落账（更新 0 行）时抛状态冲突', async () => {
    tx.scanOrders.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createBalancePayment(user, orderId, 3),
    ).rejects.toThrow('订单状态已变化');
    expect(paymentLockService.releaseLock).toHaveBeenCalledWith(
      `scan-order:${orderId}`,
      'lock-token',
    );
  });

  it('订单锁被占用时提示稍后重试，不扣款', async () => {
    paymentLockService.acquireLock.mockResolvedValue(null);

    await expect(
      service.createBalancePayment(user, orderId, 3),
    ).rejects.toThrow('订单支付处理中');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
