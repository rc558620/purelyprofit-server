import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClubPaymentCallbackSignatureService } from '../../../purely-club/payments/club-payment-callback-signature.service';
import { SmsAccountService } from './sms-account.service';
import { SmsRechargeService } from './sms-recharge.service';
import { SmsWechatCallbackDecryptorService } from './sms-wechat-callback-decryptor.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';

import { buildSmsOrderNo } from './sms.utils';

const STORE_ID = 18;
const AMOUNT_FEN = 1000;
const SMS_ORDER_NO = buildSmsOrderNo();

const SUCCESS_TX = {
  out_trade_no: SMS_ORDER_NO,
  transaction_id: 'wx-tx-1',
  trade_state: 'SUCCESS',
  mchid: '1234567890',
  appid: 'wxappid',
  amount: { total: AMOUNT_FEN },
};

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
  let signatureService: { assertWechatCallbackSignature: jest.Mock };
  let decryptorService: { decryptCallback: jest.Mock };
  let nativeService: { createNativeOrder: jest.Mock };
  let accountService: { ensureAccount: jest.Mock };

  /** 直充开关只认 true，其它取值一律按 false */
  const makeConfig = (directCredit: unknown) => ({
    get: jest.fn((key: string) =>
      key === 'sms.directCredit' ? directCredit : undefined,
    ),
  });

  const buildService = (directCredit: unknown): SmsRechargeService =>
    new SmsRechargeService(
      prisma as unknown as PrismaService,
      makeConfig(directCredit) as never,
      accountService as unknown as SmsAccountService,
      nativeService as unknown as SmsWechatNativeService,
      signatureService as unknown as ClubPaymentCallbackSignatureService,
      decryptorService as unknown as SmsWechatCallbackDecryptorService,
    );

  beforeEach(() => {
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
        }),
      },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    signatureService = { assertWechatCallbackSignature: jest.fn() };
    decryptorService = {
      // 真实解密器是同步的（纯 CPU 操作），mock 同步返回
      decryptCallback: jest.fn().mockReturnValue(SUCCESS_TX),
    };
    nativeService = {
      createNativeOrder: jest
        .fn()
        .mockResolvedValue({ codeUrl: 'weixin://wxpay/x' }),
    };
    accountService = { ensureAccount: jest.fn().mockResolvedValue({ id: 1 }) };

    service = buildService(false);
  });

  describe('本地直充（SMS_RECHARGE_DIRECT_CREDIT）', () => {
    it('开启时跳过微信下单，直接入账并返回空 codeUrl', async () => {
      service = buildService(true);

      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(nativeService.createNativeOrder).not.toHaveBeenCalled();
      // codeUrl 只在微信下单成功后回写，直充没有码可写
      expect(prisma.smsRechargeOrder.update).not.toHaveBeenCalled();
      expect(order.codeUrl).toBe('');
      expect(order.amountFen).toBe(AMOUNT_FEN);

      expect(tx.storeSmsAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceFen: { increment: AMOUNT_FEN },
            totalRechargedFen: { increment: AMOUNT_FEN },
          }),
        }),
      );
      expect(tx.smsWalletLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'recharge',
            changeFen: AMOUNT_FEN,
          }),
        }),
      );
    });

    it('开启时订单立即 paid：前端首次轮询即命中，无需扫码', async () => {
      service = buildService(true);
      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      // 直充后订单已是 paid，惰性关闭不会把它误改成 closed
      prisma.smsRechargeOrder.findUnique.mockResolvedValue({
        orderNo: order.orderNo,
        storeId: STORE_ID,
        status: 'paid',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.getRechargeOrderStatus(STORE_ID, order.orderNo),
      ).resolves.toEqual({ orderNo: order.orderNo, status: 'paid' });
    });

    it('关闭时仍走微信 Native 下单（默认行为不变）', async () => {
      service = buildService(false);

      const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(nativeService.createNativeOrder).toHaveBeenCalledTimes(1);
      expect(order.codeUrl).toBe('weixin://wxpay/x');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('开关只认 true：误配成字符串 "1" 不会开启直充', async () => {
      service = buildService('1');

      await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

      expect(nativeService.createNativeOrder).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('下单成功返回 codeUrl 与过期时间', async () => {
    const order = await service.createRechargeOrder(STORE_ID, AMOUNT_FEN);

    expect(order.amountFen).toBe(AMOUNT_FEN);
    expect(order.codeUrl).toBe('weixin://wxpay/x');
    expect(prisma.smsRechargeOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: STORE_ID,
          amountFen: AMOUNT_FEN,
          status: 'pending',
        }),
      }),
    );
  });

  it('微信下单失败时订单落 failed 并向上抛出（否则前端会永远轮询）', async () => {
    nativeService.createNativeOrder.mockRejectedValue(
      new InternalServerErrorException('微信支付下单失败'),
    );

    await expect(
      service.createRechargeOrder(STORE_ID, AMOUNT_FEN),
    ).rejects.toThrow(InternalServerErrorException);

    expect(prisma.smsRechargeOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
  });

  it('轮询：pending 且已过期时惰性置 closed；未过期保持 pending', async () => {
    prisma.smsRechargeOrder.findUnique.mockResolvedValueOnce({
      orderNo: SMS_ORDER_NO,
      storeId: STORE_ID,
      status: 'pending',
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expect(
      service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
    ).resolves.toEqual({
      orderNo: SMS_ORDER_NO,
      status: 'closed',
    });

    prisma.smsRechargeOrder.findUnique.mockResolvedValueOnce({
      orderNo: SMS_ORDER_NO,
      storeId: STORE_ID,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
    ).resolves.toEqual({
      orderNo: SMS_ORDER_NO,
      status: 'pending',
    });
  });

  it('跨门店查询订单视为不存在', async () => {
    prisma.smsRechargeOrder.findUnique.mockResolvedValue({
      orderNo: SMS_ORDER_NO,
      storeId: 999,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.getRechargeOrderStatus(STORE_ID, SMS_ORDER_NO),
    ).rejects.toThrow(NotFoundException);
  });
});
