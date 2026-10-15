// 短信充值**微信回调**相关用例（下单 / 直充 / 轮询见 sms-recharge.service.spec.ts）
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
const CLUB_ORDER_NO = 'RC202610152030001234AB';

const SUCCESS_TX = {
  out_trade_no: SMS_ORDER_NO,
  transaction_id: 'wx-tx-1',
  trade_state: 'SUCCESS',
  mchid: '1234567890',
  appid: 'wxappid',
  amount: { total: AMOUNT_FEN },
};

describe('SmsRechargeService · 微信回调', () => {
  let service: SmsRechargeService;
  let prisma: {
    smsRechargeOrder: {
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

  const headers = {
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: 'n',
    signature: 's',
    serial: 'serial',
  };

  const callbackPayload = {
    resource: { algorithm: 'AEAD_AES_256_GCM' },
  } as never;

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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          orderNo: SMS_ORDER_NO,
          storeId: STORE_ID,
          amountFen: AMOUNT_FEN,
          status: 'pending',
        }),
      },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    signatureService = { assertWechatCallbackSignature: jest.fn() };
    // 真实解密器是同步的（纯 CPU 操作），mock 同步返回
    decryptorService = {
      decryptCallback: jest.fn().mockReturnValue(SUCCESS_TX),
    };

    service = new SmsRechargeService(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as never,
      { ensureAccount: jest.fn() } as unknown as SmsAccountService,
      null as unknown as SmsWechatNativeService,
      signatureService as unknown as ClubPaymentCallbackSignatureService,
      decryptorService as unknown as SmsWechatCallbackDecryptorService,
    );
  });

  it('回调入账：余额与累计充值增加，写一条 recharge 流水', async () => {
    const ack = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );

    expect(signatureService.assertWechatCallbackSignature).toHaveBeenCalledWith(
      '{}',
      headers,
    );
    expect(ack).toMatchObject({ success: true, status: 'paid' });
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

  it('微信重复投递同一回调只入账一次', async () => {
    const first = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );
    const second = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );

    expect(first.message).toBe('充值已入账');
    expect(second.message).toBe('重复回调，已忽略');
    expect(tx.smsWalletLog.create).toHaveBeenCalledTimes(1);
    expect(tx.storeSmsAccount.update).toHaveBeenCalledTimes(1);
  });

  it('非 SM 前缀订单号（club 订单串台）直接忽略，绝不入账', async () => {
    decryptorService.decryptCallback.mockReturnValue({
      ...SUCCESS_TX,
      out_trade_no: CLUB_ORDER_NO,
    });

    const ack = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );

    expect(ack.success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trade_state 非 SUCCESS 时标记订单失败且不入账', async () => {
    decryptorService.decryptCallback.mockReturnValue({
      ...SUCCESS_TX,
      trade_state: 'CLOSED',
    });

    const ack = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );

    expect(ack).toMatchObject({ success: false, status: 'failed' });
    expect(prisma.smsRechargeOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('订单不存在时不入账，返回 failed 而非抛异常（避免微信无限重试）', async () => {
    prisma.smsRechargeOrder.findUnique.mockResolvedValue(null);

    const ack = await service.handleWechatCallback(
      callbackPayload,
      headers,
      '{}',
    );

    expect(ack).toMatchObject({ success: false, message: '订单不存在' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
