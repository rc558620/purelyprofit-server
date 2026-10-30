import { getQueueToken } from '@nestjs/bullmq';
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
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
    extractMerchantIdentity: jest.fn(),
  };

  const identityService = {
    isPartnerMode: jest.fn(),
    getPartnerSpMchId: jest.fn(),
    resolveTarget: jest.fn(),
  };

  const paymentOrderRecordService = {
    findByOrderNo: jest.fn(),
    persistMerchantIdentity: jest.fn(),
  };

  /** 服务购买单（SV）草稿：无落库表，门店 ID 只能从这里取 */
  const clubOrderDraftsService = {
    getDraftByOrderId: jest.fn(),
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

    // 默认按直连模式 + 商户号一致配置，具体用例再覆写
    identityService.isPartnerMode.mockReturnValue(false);
    identityService.getPartnerSpMchId.mockReturnValue('SP0001');
    identityService.resolveTarget.mockResolvedValue({
      mode: 'store',
      signMchId: 'mch123',
      settleMchId: 'mch123',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'mch123',
      settleMchId: 'mch123',
    });
    paymentOrderRecordService.findByOrderNo.mockResolvedValue({
      kind: 'recharge',
      storeId: 1,
      spMchId: null,
      subMchId: null,
    });
    paymentOrderRecordService.persistMerchantIdentity.mockResolvedValue(
      'recharge',
    );
    clubOrderDraftsService.getDraftByOrderId.mockRejectedValue(
      new Error('订单不存在'),
    );

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
          provide: ClubWechatPayIdentityService,
          useValue: identityService,
        },
        {
          provide: ClubPaymentOrderRecordService,
          useValue: paymentOrderRecordService,
        },
        {
          provide: ClubOrderDraftsService,
          useValue: clubOrderDraftsService,
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

    // 第三个参数 'club' 声明本回调归属 C 端门店收款链路：
    // 服务商模式开启后该链路改用服务商维度的平台证书验签
    expect(
      clubPaymentCallbackSignatureService.assertWechatCallbackSignature,
    ).toHaveBeenCalledWith(rawBody, headers, 'club');
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

  it('回调商户号与门店配置一致时把权威商户号写回订单', async () => {
    identityService.isPartnerMode.mockReturnValue(true);
    identityService.resolveTarget.mockResolvedValue({
      mode: 'partner',
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
    });

    await service.handleWechatCallback(
      makeCallbackPayload(),
      {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      },
      '{}',
    );

    expect(
      paymentOrderRecordService.persistMerchantIdentity,
    ).toHaveBeenCalledWith('RC202606101231000001A2B', 'SP0001', 'SUB0001');
  });

  it('服务商模式下 sp_mchid 与平台配置不一致时拒绝入账', async () => {
    identityService.isPartnerMode.mockReturnValue(true);
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP_OTHER',
      settleMchId: 'SUB0001',
    });

    await expect(
      service.handleWechatCallback(
        makeCallbackPayload(),
        {
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: 'callback-nonce',
          signature: 'SIGNATURE',
          serial: 'CERT_SERIAL_001',
        },
        '{}',
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(paymentCallbackQueue.add).not.toHaveBeenCalled();
  });

  it('回调 sub_mchid 与门店配置不一致时拒绝入账（防止换绑后资金错配）', async () => {
    identityService.isPartnerMode.mockReturnValue(true);
    identityService.resolveTarget.mockResolvedValue({
      mode: 'partner',
      signMchId: 'SP0001',
      settleMchId: 'SUB_CURRENT',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP0001',
      settleMchId: 'SUB_OLD',
    });

    await expect(
      service.handleWechatCallback(
        makeCallbackPayload(),
        {
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: 'callback-nonce',
          signature: 'SIGNATURE',
          serial: 'CERT_SERIAL_001',
        },
        '{}',
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(paymentCallbackQueue.add).not.toHaveBeenCalled();
  });

  it('自助下单（SF）：经 SelfOrder 关联拿到门店并完成比对与落库', async () => {
    identityService.isPartnerMode.mockReturnValue(true);
    identityService.resolveTarget.mockResolvedValue({
      mode: 'partner',
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
    });
    paymentOrderRecordService.findByOrderNo.mockResolvedValue({
      kind: 'self_ordering',
      storeId: 9,
      spMchId: null,
      subMchId: null,
    });

    await service.handleWechatCallback(
      makeCallbackPayload(),
      {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      },
      '{}',
    );

    expect(
      paymentOrderRecordService.persistMerchantIdentity,
    ).toHaveBeenCalledWith('RC202606101231000001A2B', 'SP0001', 'SUB0001');
  });

  it('服务购买单（SV）：无落库表时从草稿取门店，校验通过但明确不假装落库', async () => {
    identityService.isPartnerMode.mockReturnValue(true);
    identityService.resolveTarget.mockResolvedValue({
      mode: 'partner',
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP0001',
      settleMchId: 'SUB0001',
    });
    paymentOrderRecordService.findByOrderNo.mockResolvedValue(null);
    clubOrderDraftsService.getDraftByOrderId.mockResolvedValue({ storeId: 9 });

    await service.handleWechatCallback(
      makeCallbackPayload(),
      {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      },
      '{}',
    );

    expect(clubOrderDraftsService.getDraftByOrderId).toHaveBeenCalledWith(
      'RC202606101231000001A2B',
      'service',
    );
    // 没有订单表可写，不能假装落库成功
    expect(
      paymentOrderRecordService.persistMerchantIdentity,
    ).not.toHaveBeenCalled();
    // 但入账不受影响：草稿型订单不能因为存不下商户号就被拒收
    expect(paymentCallbackQueue.add).toHaveBeenCalled();
  });

  it('服务购买单且草稿也不存在时：跳过比对但放行入账', async () => {
    paymentOrderRecordService.findByOrderNo.mockResolvedValue(null);
    clubOrderDraftsService.getDraftByOrderId.mockRejectedValue(
      new Error('订单不存在'),
    );

    await service.handleWechatCallback(
      makeCallbackPayload(),
      {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      },
      '{}',
    );

    expect(paymentCallbackQueue.add).toHaveBeenCalled();
    expect(
      paymentOrderRecordService.persistMerchantIdentity,
    ).not.toHaveBeenCalled();
  });

  it('服务购买单商户号与门店配置不一致时同样拒绝入账', async () => {
    paymentOrderRecordService.findByOrderNo.mockResolvedValue(null);
    clubOrderDraftsService.getDraftByOrderId.mockResolvedValue({ storeId: 9 });
    identityService.resolveTarget.mockResolvedValue({
      mode: 'partner',
      signMchId: 'SP0001',
      settleMchId: 'SUB_CURRENT',
      appId: 'app123',
      notifyUrl: 'https://api.example.com/callback',
    });
    clubWechatCallbackDecryptorService.extractMerchantIdentity.mockReturnValue({
      signMchId: 'SP0001',
      settleMchId: 'SUB_OTHER',
    });

    await expect(
      service.handleWechatCallback(
        makeCallbackPayload(),
        {
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: 'callback-nonce',
          signature: 'SIGNATURE',
          serial: 'CERT_SERIAL_001',
        },
        '{}',
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(paymentCallbackQueue.add).not.toHaveBeenCalled();
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

  it('handleWechatCallback 在非 TRANSACTION.SUCCESS 事件时回 200 忽略，不落账', async () => {
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

    // 按微信回调协议必须回 200：返回 4xx 会被判定为通知失败并无限重投，
    // 而 REFUND.* 这类事件重投多少次也不会变成可处理事件
    const ack = await service.handleWechatCallback(payload, headers, '{}');
    expect(ack).toEqual({
      success: true,
      orderNo: '',
      orderType: 'unknown',
      status: 'ignored',
    });
    expect(
      clubWechatCallbackDecryptorService.decryptCallback,
    ).not.toHaveBeenCalled();
    expect(
      clubPaymentCallbackDispatchService.dispatchByOrderNo,
    ).not.toHaveBeenCalled();
  });
});
