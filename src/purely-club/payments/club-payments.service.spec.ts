import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import { ClubPaymentsService } from './club-payments.service';
import type { ClubWechatPaymentCallbackDto } from './dto/club-wechat-callback.dto';

describe('ClubPaymentsService', () => {
  let service: ClubPaymentsService;

  const clubPaymentCallbackSignatureService = {
    assertWechatCallbackSignature: jest.fn(),
  };

  const clubPaymentCallbackDispatchService = {
    dispatchByOrderNo: jest.fn(),
  };

  const clubWechatCallbackDecryptorService = {
    decryptCallback: jest.fn(),
    validateAndExtract: jest.fn(),
  };

  const paymentCallbackQueue = {
    add: jest.fn(),
  };

  const makeCallbackPayload = (): ClubWechatPaymentCallbackDto => ({
    id: 'notify-id-123',
    create_time: '2026-06-10T12:31:00+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    summary: '支付成功',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: 'BASE64_ENCRYPTED_CONTENT',
      nonce: 'NONCE12345678',
      associated_data: 'transaction',
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentsService,
        {
          provide: ClubPaymentCallbackSignatureService,
          useValue: clubPaymentCallbackSignatureService,
        },
        {
          provide: ClubPaymentCallbackDispatchService,
          useValue: clubPaymentCallbackDispatchService,
        },
        {
          provide: ClubWechatCallbackDecryptorService,
          useValue: clubWechatCallbackDecryptorService,
        },
        {
          provide: getQueueToken('club-payment-callback'),
          useValue: paymentCallbackQueue,
        },
      ],
    }).compile();

    service = module.get<ClubPaymentsService>(ClubPaymentsService);
  });

  it('handleWechatCallback 先验签，解密，再落账，最终返回 ack', async () => {
    const payload = makeCallbackPayload();
    const rawBody = JSON.stringify(payload);
    const headers = {
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: 'callback-nonce',
      signature: 'CALLBACK_SIGNATURE',
      serial: 'CERT_SERIAL_001',
    };

    const decryptedTx = {
      out_trade_no: 'RC202606101231000001A2B',
      transaction_id: 'wxTx123',
      trade_state: 'SUCCESS',
      mchid: 'mch123',
      appid: 'app123',
    };
    clubWechatCallbackDecryptorService.decryptCallback.mockResolvedValue(
      decryptedTx,
    );
    clubWechatCallbackDecryptorService.validateAndExtract.mockReturnValue({
      orderNo: 'RC202606101231000001A2B',
      transactionId: 'wxTx123',
      amountFen: 50000,
      paidAt: '2026-06-10T12:31:00+08:00',
    });
    paymentCallbackQueue.add.mockResolvedValue({});

    await expect(
      service.handleWechatCallback(payload, headers, rawBody),
    ).resolves.toEqual({
      success: true,
      orderNo: 'RC202606101231000001A2B',
      orderType: 'scan_ordering',
      status: 'pending',
    });

    expect(
      clubPaymentCallbackSignatureService.assertWechatCallbackSignature,
    ).toHaveBeenCalledWith(rawBody, headers);
    expect(
      clubWechatCallbackDecryptorService.decryptCallback,
    ).toHaveBeenCalledWith(payload);
    expect(paymentCallbackQueue.add).toHaveBeenCalledWith(
      'wechat-payment:RC202606101231000001A2B',
      {
        orderNo: 'RC202606101231000001A2B',
        settlementParams: expect.objectContaining({
          amountFen: 50000,
          transactionId: 'wxTx123',
        }),
      },
      expect.objectContaining({
        jobId: 'wechat-payment:RC202606101231000001A2B:wxTx123',
        attempts: 5,
      }),
    );
    expect(
      clubPaymentCallbackDispatchService.dispatchByOrderNo,
    ).not.toHaveBeenCalled();
  });

  it('handleWechatCallback 在验签失败时停止后续处理', async () => {
    const payload = makeCallbackPayload();
    const headers = {
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: 'callback-nonce',
      signature: 'BAD_SIGNATURE',
      serial: 'CERT_SERIAL_001',
    };
    clubPaymentCallbackSignatureService.assertWechatCallbackSignature.mockImplementation(
      () => {
        throw new Error('invalid-signature');
      },
    );

    await expect(
      service.handleWechatCallback(payload, headers, '{}'),
    ).rejects.toThrow('invalid-signature');
    expect(
      clubWechatCallbackDecryptorService.decryptCallback,
    ).not.toHaveBeenCalled();
    expect(
      clubPaymentCallbackDispatchService.dispatchByOrderNo,
    ).not.toHaveBeenCalled();
  });

  it('handleWechatCallback 在非 TRANSACTION.SUCCESS 事件时拒绝处理', async () => {
    // 让验签 mock 通过，测试事件类型过滤逻辑
    clubPaymentCallbackSignatureService.assertWechatCallbackSignature.mockImplementation(
      () => undefined,
    );

    const payload = makeCallbackPayload();
    payload.event_type = 'REFUND.SUCCESS';
    const headers = {
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: 'callback-nonce',
      signature: 'SIGNATURE',
      serial: 'CERT_SERIAL_001',
    };

    await expect(
      service.handleWechatCallback(payload, headers, '{}'),
    ).rejects.toThrow(BadRequestException);
    expect(
      clubWechatCallbackDecryptorService.decryptCallback,
    ).not.toHaveBeenCalled();
  });
});
