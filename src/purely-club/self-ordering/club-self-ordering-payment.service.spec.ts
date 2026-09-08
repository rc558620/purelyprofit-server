import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubScanOrderingMarketingCustomerService } from '../scan-ordering/club-scan-ordering-marketing-customer.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import { ClubSelfOrderingPaymentService } from './club-self-ordering-payment.service';
import { ClubSelfOrderingSessionBridgeService } from './club-self-ordering-session-bridge.service';

/**
 * 自助下单支付测试：
 * - 余额支付：条件扣减（balance >= 应付额）+ 乐观锁置为已支付 + 流水 + 商品写入空间账单
 * - 微信支付：在途拦截；openid 缺省返回空 paymentParams（供开发态兜底）
 * - 开发态确认：生产环境禁用；非生产直接落账且不扣余额
 */
describe('ClubSelfOrderingPaymentService', () => {
  let service: ClubSelfOrderingPaymentService;

  const prisma = {
    selfOrder: { findFirst: jest.fn() },
    selfOrderPaymentAttempt: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    space: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  /** 事务内客户端 mock */
  const tx = {
    marketingCustomer: { updateMany: jest.fn() },
    selfOrder: { updateMany: jest.fn() },
    selfOrderPaymentAttempt: { updateMany: jest.fn(), upsert: jest.fn() },
    selfOrderBalanceTransaction: { upsert: jest.fn() },
  };

  const config = { get: jest.fn() };
  const paymentLock = {
    withOrderLock: jest.fn((_key: string, cb: () => Promise<unknown>) => cb()),
  };
  const wechatJsapi = { createJsapiPaymentParams: jest.fn() };
  const marketingCustomer = { resolveActiveCustomer: jest.fn() };
  const sessionBridge = { appendPaidItemsToSession: jest.fn() };
  const realtimeService = {
    publishSelfOrderCreated: jest.fn(),
    publishSelfOrderStatusChanged: jest.fn(),
  };

  const user = { id: 100 } as unknown as AuthenticatedUser;

  const pendingOrder = {
    id: 1,
    orderNo: 'SF-1',
    storeId: 1,
    sessionId: 42,
    spaceId: 7,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    payableAmount: 1600,
    version: 0,
    createdAt: new Date(),
    items: [
      {
        id: 11,
        productId: '101',
        productName: '可口可乐',
        categoryName: '酒水饮料',
        salePrice: 800,
        costPrice: 300,
        quantity: 2,
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    config.get.mockReturnValue('development');
    prisma.selfOrder.findFirst.mockResolvedValue(pendingOrder);
    prisma.selfOrderPaymentAttempt.findFirst.mockResolvedValue(null);
    prisma.selfOrderPaymentAttempt.create.mockResolvedValue({});
    prisma.selfOrderPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    marketingCustomer.resolveActiveCustomer.mockResolvedValue({
      id: 55,
      balance: 5000,
    });
    prisma.space.findUnique.mockResolvedValue({ name: 'A03' });
    tx.marketingCustomer.updateMany.mockResolvedValue({ count: 1 });
    tx.selfOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.selfOrderPaymentAttempt.upsert.mockResolvedValue({});
    tx.selfOrderPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.selfOrderBalanceTransaction.upsert.mockResolvedValue({});
    sessionBridge.appendPaidItemsToSession.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubSelfOrderingPaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: ClubPaymentLockService, useValue: paymentLock },
        { provide: ClubWechatJsapiService, useValue: wechatJsapi },
        {
          provide: ClubScanOrderingMarketingCustomerService,
          useValue: marketingCustomer,
        },
        {
          provide: ClubSelfOrderingSessionBridgeService,
          useValue: sessionBridge,
        },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
      ],
    }).compile();
    service = module.get<ClubSelfOrderingPaymentService>(
      ClubSelfOrderingPaymentService,
    );
  });

  describe('余额支付', () => {
    it('支付成功：条件扣减余额并以乐观锁置为已支付', async () => {
      await service.createBalancePayment(user, 1);

      expect(tx.marketingCustomer.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 55,
          balance: { gte: 1600 },
          status: 'active',
        }),
        data: { balance: { decrement: 1600 } },
      });
      expect(tx.selfOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          version: 0,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
        },
        data: expect.objectContaining({
          status: 'paid',
          paymentStatus: 'paid',
          paidAmount: 1600,
          version: { increment: 1 },
        }),
      });
    });

    it('支付成功：写入余额流水并把商品写入空间账单', async () => {
      await service.createBalancePayment(user, 1);

      expect(tx.selfOrderBalanceTransaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId_type: { orderId: 1, type: 'payment' } },
        }),
      );
      expect(sessionBridge.appendPaidItemsToSession).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          sessionId: 42,
          orderNo: 'SF-1',
        }),
      );
      // 落账成功后广播商家端新订单通知（purelyProfit 右下角弹窗数据源）
      expect(realtimeService.publishSelfOrderCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 1,
          orderNo: 'SF-1',
          sessionId: 42,
          spaceId: 7,
          spaceName: 'A03',
          amountFen: 1600,
        }),
      );
    });

    it('余额不足时拒绝支付', async () => {
      tx.marketingCustomer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.createBalancePayment(user, 1)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.selfOrder.updateMany).not.toHaveBeenCalled();
      expect(sessionBridge.appendPaidItemsToSession).not.toHaveBeenCalled();
    });

    it('订单状态已变化时不重复落账', async () => {
      tx.selfOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.createBalancePayment(user, 1)).rejects.toThrow(
        '订单状态已变化，请刷新后重试',
      );
      expect(sessionBridge.appendPaidItemsToSession).not.toHaveBeenCalled();
    });

    it('订单不存在时拒绝', async () => {
      prisma.selfOrder.findFirst.mockResolvedValue(null);

      await expect(service.createBalancePayment(user, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('微信支付', () => {
    it('存在在途支付尝试时拒绝重复发起', async () => {
      prisma.selfOrderPaymentAttempt.findFirst.mockResolvedValue({ id: 9 });

      await expect(
        service.createWechatPayment(user, 1, 'openid-1'),
      ).rejects.toThrow(ConflictException);
      expect(wechatJsapi.createJsapiPaymentParams).not.toHaveBeenCalled();
    });

    it('超过存活时限的旧在途尝试会被回收，允许重新发起支付', async () => {
      wechatJsapi.createJsapiPaymentParams.mockResolvedValue({
        timeStamp: '1',
        nonceStr: 'n',
        package: 'prepay_id=wx2',
        signType: 'RSA',
        paySign: 's',
      });
      // 回收后不存在在途尝试（旧尝试已被 updateMany 置为 failed）
      prisma.selfOrderPaymentAttempt.findFirst.mockResolvedValue(null);

      const result = await service.createWechatPayment(user, 1, 'openid-1');

      // 回收调用：只清理 createdAt 早于 5 分钟阈值的在途记录
      expect(prisma.selfOrderPaymentAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderId: 1,
            status: { in: ['pending', 'paying', 'created'] },
            createdAt: { lt: expect.any(Date) },
          }),
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
      // 重新发起成功，拿到新支付参数
      expect(wechatJsapi.createJsapiPaymentParams).toHaveBeenCalled();
      expect(result.paymentParams).toEqual(
        expect.objectContaining({ package: 'prepay_id=wx2' }),
      );
    });

    it('openid 缺省时不调用微信下单，返回空支付参数', async () => {
      const result = await service.createWechatPayment(user, 1);

      expect(wechatJsapi.createJsapiPaymentParams).not.toHaveBeenCalled();
      expect(result.paymentParams).toBeUndefined();
      expect(result.merchantPaymentNo).toContain('SF-1-');
      // 记录一条 pending 尝试，供开发态确认时置为成功
      expect(prisma.selfOrderPaymentAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending', amountFen: 1600 }),
        }),
      );
    });

    it('传入 openid 时下单并返回支付参数', async () => {
      wechatJsapi.createJsapiPaymentParams.mockResolvedValue({
        timeStamp: '1',
        nonceStr: 'n',
        package: 'prepay_id=wx1',
        signType: 'RSA',
        paySign: 's',
      });

      const result = await service.createWechatPayment(user, 1, 'openid-1');

      expect(wechatJsapi.createJsapiPaymentParams).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 1,
          amountFen: 1600,
          openid: 'openid-1',
        }),
      );
      expect(result.paymentParams).toEqual(
        expect.objectContaining({ package: 'prepay_id=wx1' }),
      );
    });

    it('微信下单失败时把支付尝试置为 failed', async () => {
      wechatJsapi.createJsapiPaymentParams.mockRejectedValue(
        new Error('微信下单失败'),
      );

      await expect(
        service.createWechatPayment(user, 1, 'openid-1'),
      ).rejects.toThrow('微信下单失败');
      expect(prisma.selfOrderPaymentAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });
  });

  describe('开发态确认支付', () => {
    it('生产环境禁用', async () => {
      config.get.mockReturnValue('production');

      await expect(service.confirmPaidForDevelopment(user, 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('非生产环境直接落账且不扣余额', async () => {
      await service.confirmPaidForDevelopment(user, 1);

      expect(tx.marketingCustomer.updateMany).not.toHaveBeenCalled();
      expect(tx.selfOrderBalanceTransaction.upsert).not.toHaveBeenCalled();
      // 落账与写入空间账单仍然执行，保证流程与真实支付一致
      expect(tx.selfOrder.updateMany).toHaveBeenCalled();
      expect(sessionBridge.appendPaidItemsToSession).toHaveBeenCalled();
    });
  });
});
