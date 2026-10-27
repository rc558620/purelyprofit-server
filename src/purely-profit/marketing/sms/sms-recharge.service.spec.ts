import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import { SmsRechargeService } from './sms-recharge.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';
import { PlatformPaymentRealtimeService } from '../../payments/platform-payment-realtime.service';
import { buildSmsOrderNo } from './sms.utils';

const STORE_ID = 18;
const AMOUNT_FEN = 1000;
const SMS_ORDER_NO = buildSmsOrderNo();

describe('SmsRechargeService', () => {
  let service: SmsRechargeService;
  let prisma: {
    smsRechargeOrder: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    smsRechargeOrder: { updateMany: jest.Mock };
    storeSmsAccount: { update: jest.Mock };
    smsWalletLog: { create: jest.Mock };
  };
  let nativeService: {
    createNativeOrder: jest.Mock;
    closeNativeOrder: jest.Mock;
  };
  let accountService: {
    ensureAccount: jest.Mock;
    resolveRechargeTiers: jest.Mock;
  };
  let qrCodeService: { renderPaymentQrCode: jest.Mock };
  let realtimeService: {
    publishPaid: jest.Mock;
    publishFailed: jest.Mock;
    publishClosed: jest.Mock;
  };

  /** 商家端支付模式裁决桩：默认不跳过真实扣款，由用例按需覆盖 */
  const paymentMode = {
    isSkipPaymentAllowed: jest.fn(
      (): Promise<boolean> => Promise.resolve(false),
    ),
  };

  const buildService = (): SmsRechargeService =>
    new SmsRechargeService(
      prisma as unknown as PrismaService,
      accountService as unknown as SmsAccountService,
      nativeService as unknown as SmsWechatNativeService,
      qrCodeService as never,
      paymentMode as never,
      realtimeService as unknown as PlatformPaymentRealtimeService,
    );

  beforeEach(() => {
    paymentMode.isSkipPaymentAllowed.mockResolvedValue(false);
    tx = {
      // 条件更新：只有 status != paid 才返回 count 1，第二次变 0（重复回调）
      smsRechargeOrder: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValue({ count: 0 }),
      },
      storeSmsAccount: {
        update: jest.fn().mockResolvedValue({ balanceFen: AMOUNT_FEN }),
      },
      smsWalletLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };

    prisma = {
      smsRechargeOrder: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          orderNo: SMS_ORDER_NO,
          storeId: STORE_ID,
          amountFen: AMOUNT_FEN,
          status: 'pending',
          expiresAt: new Date(Date.now() + 60_000),
          codeUrl: 'weixin://wxpay/x',
        }),
      },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    nativeService = {
      createNativeOrder: jest
        .fn()
        .mockResolvedValue({ codeUrl: 'weixin://wxpay/x' }),
      closeNativeOrder: jest.fn().mockResolvedValue('closed'),
    };
    accountService = {
      ensureAccount: jest.fn().mockResolvedValue({ id: 1 }),
      // 金额必须命中后端档位：测试只开放 1000 分这一档
      resolveRechargeTiers: jest.fn().mockReturnValue([
        { amountFen: AMOUNT_FEN, amountDisplay: '¥10' },
        { amountFen: 5000, amountDisplay: '¥50' },
      ]),
    };
    qrCodeService = {
      renderPaymentQrCode: jest
        .fn()
        .mockResolvedValue('data:image/png;base64,MOCK'),
    };
    realtimeService = {
      publishPaid: jest.fn(),
      publishFailed: jest.fn(),
      publishClosed: jest.fn(),
    };

    service = buildService();
  });

  describe('金额权威性', () => {
    it('金额不在后端档位内时拒绝下单', async () => {
      await expect(service.createRechargeOrder(STORE_ID, 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.smsRechargeOrder.create).not.toHaveBeenCalled();
    });

    it('命中的档位金额按后端档位原值下单', async () => {
      await service.createRechargeOrder(STORE_ID, 5000);

      expect(prisma.smsRechargeOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountFen: 5000 }),
        }),
      );
    });
  });

  describe('支付模式裁决', () => {
    it('全局测试模式：跳过微信下单，直接入账并回传 paid 状态', async () => {
      paymentMode.isSkipPaymentAllowed.mockResolvedValue(true);

      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(nativeService.createNativeOrder).not.toHaveBeenCalled();
      expect(order.codeUrl).toBe('');
      // 前端只看 status，不必先渲染二维码再等轮询才发现已到账
      expect(order.status).toBe('paid');

      expect(tx.smsRechargeOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'paid', payMode: 'test' }),
        }),
      );
      expect(tx.smsWalletLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'recharge',
            payMode: 'test',
            changeFen: AMOUNT_FEN,
            description: '测试充值 ¥10',
          }),
        }),
      );
    });

    it('全局真实模式：走微信 Native 下单，订单保持 pending', async () => {
      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(nativeService.createNativeOrder).toHaveBeenCalledTimes(1);
      expect(order.status).toBe('pending');
      expect(order.codeUrl).toBe('weixin://wxpay/x');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.smsRechargeOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending', payMode: 'live' }),
        }),
      );
    });

    it('真实下单返回二维码图片，而非无法展示的 weixin:// 协议串', async () => {
      nativeService.createNativeOrder.mockResolvedValue({
        codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
      });
      prisma.smsRechargeOrder.update.mockResolvedValue(undefined);

      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(order.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc');
      // 前端 <img> 加载不了 weixin://，必须同时给出可展示的图
      expect(order.qrCodeImageUrl).toBe('data:image/png;base64,MOCK');
    });
  });

  describe('下单失败回滚', () => {
    it('微信下单失败时订单落 failed 并向上抛出（否则前端会永远轮询）', async () => {
      nativeService.createNativeOrder.mockRejectedValue(
        new InternalServerErrorException('微信支付下单失败'),
      );

      await expect(
        service.createRechargeOrder(STORE_ID, AMOUNT_FEN),
      ).rejects.toThrow(InternalServerErrorException);

      expect(prisma.smsRechargeOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'failed' } }),
      );
    });

    it('二维码出图失败时回滚微信订单，避免留下可支付的悬空单', async () => {
      qrCodeService.renderPaymentQrCode.mockRejectedValue(
        new Error('出图失败'),
      );

      await expect(
        service.createRechargeOrder(STORE_ID, AMOUNT_FEN),
      ).rejects.toThrow('出图失败');

      // 下单时订单号是服务端现生成的，这里只断言「关了同一笔单」
      expect(nativeService.closeNativeOrder).toHaveBeenCalledWith(
        expect.any(String),
      );
      expect(prisma.smsRechargeOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'failed' } }),
      );
    });
  });

  describe('过期惰性关闭', () => {
    it('pending 且已过期：先关微信单，再置 closed', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: STORE_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
        codeUrl: 'weixin://wxpay/x',
      });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'closed' });

      expect(nativeService.closeNativeOrder).toHaveBeenCalledWith(SMS_ORDER_NO);
    });

    it('微信侧其实已支付：本地绝不关单，保持 pending 等回调', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: STORE_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
        codeUrl: 'weixin://wxpay/x',
      });
      nativeService.closeNativeOrder.mockResolvedValue('paid');

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'pending' });

      expect(prisma.smsRechargeOrder.updateMany).not.toHaveBeenCalled();
    });

    it('微信关单失败：本地保持 pending，不误标 closed', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: STORE_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
        codeUrl: 'weixin://wxpay/x',
      });
      nativeService.closeNativeOrder.mockRejectedValue(
        new InternalServerErrorException('微信支付关单失败'),
      );

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'pending' });
    });

    it('直充单没有微信订单，过期时不调用微信关单', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: STORE_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
        codeUrl: null,
      });

      await service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO);

      expect(nativeService.closeNativeOrder).not.toHaveBeenCalled();
    });

    it('条件关单未命中（并发被改成 paid）时不覆盖状态', async () => {
      prisma.smsRechargeOrder.findUnique
        .mockResolvedValueOnce({
          orderNo: SMS_ORDER_NO,
          storeId: STORE_ID,
          status: 'pending',
          expiresAt: new Date(Date.now() - 1_000),
          codeUrl: 'weixin://wxpay/x',
        })
        .mockResolvedValueOnce({ status: 'paid' });
      prisma.smsRechargeOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'paid' });
    });

    it('未过期保持 pending', async () => {
      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'pending' });
    });

    it('跨门店查询订单视为不存在', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: 999,
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
        codeUrl: 'weixin://wxpay/x',
      });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markOrderFailed 返回值（决定回调是否推 failed）', () => {
    it('订单确实是 pending 时返回 true', async () => {
      prisma.smsRechargeOrder.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.markOrderFailed(SMS_ORDER_NO)).resolves.toBe(true);
    });

    it('订单已不是 pending（多半已 paid）时返回 false：回调据此跳过 failed 推送', async () => {
      prisma.smsRechargeOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markOrderFailed(SMS_ORDER_NO)).resolves.toBe(false);
    });
  });

  describe('实时推送', () => {
    it('惰性关单成功时推送 closed：前端不再轮询后这是 closed 的唯一触发源', async () => {
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: SMS_ORDER_NO,
        storeId: STORE_ID,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000),
        codeUrl: 'weixin://wxpay/x',
      });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'closed' });

      expect(realtimeService.publishClosed).toHaveBeenCalledWith(SMS_ORDER_NO);
      expect(realtimeService.publishPaid).not.toHaveBeenCalled();
    });

    it('关单竞争失败（count===0，多半已支付）时不推 closed：避免与 paid 冲突', async () => {
      prisma.smsRechargeOrder.findUnique
        .mockResolvedValueOnce({
          orderNo: SMS_ORDER_NO,
          storeId: STORE_ID,
          status: 'pending',
          expiresAt: new Date(Date.now() - 1_000),
          codeUrl: 'weixin://wxpay/x',
        })
        .mockResolvedValueOnce({ status: 'paid' });
      prisma.smsRechargeOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
      ).resolves.toEqual({ orderNo: SMS_ORDER_NO, status: 'paid' });

      expect(realtimeService.publishClosed).not.toHaveBeenCalled();
    });

    it('未过期的 pending 单不推送任何终态', async () => {
      await service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO);

      expect(realtimeService.publishClosed).not.toHaveBeenCalled();
      expect(realtimeService.publishFailed).not.toHaveBeenCalled();
      expect(realtimeService.publishPaid).not.toHaveBeenCalled();
    });
  });

  // 回调验签 / 解密 / 金额核对见 sms-recharge-callback.service.spec.ts
});
