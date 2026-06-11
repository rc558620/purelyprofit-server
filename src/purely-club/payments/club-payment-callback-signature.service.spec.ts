import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';

describe('ClubPaymentCallbackSignatureService', () => {
  let service: ClubPaymentCallbackSignatureService;

  const configState: Record<string, string | number> = {
    'club.wechatCallbackSecret': 'callback-secret',
    'club.wechatCallbackMaxAgeSeconds': 300,
  };

  const configService = {
    get: jest.fn((key: string) => configState[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configState['club.wechatCallbackSecret'] = 'callback-secret';
    configState['club.wechatCallbackMaxAgeSeconds'] = 300;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentCallbackSignatureService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ClubPaymentCallbackSignatureService>(
      ClubPaymentCallbackSignatureService,
    );
  });

  it('assertWechatCallbackSignature 在签名有效时通过校验', () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
      paidAt: '2026-06-10T12:31:00.000Z',
    };
    const headers = createSignedHeaders(service, payload);

    expect(() => service.assertWechatCallbackSignature(payload, headers)).not.toThrow();
  });

  it('assertWechatCallbackSignature 在回调已过期时拒绝通过', () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
    };
    const headers = createSignedHeaders(service, payload, {
      timestamp: String(Math.floor(Date.now() / 1000) - 301),
    });

    expect(() => service.assertWechatCallbackSignature(payload, headers)).toThrow(
      UnauthorizedException,
    );
  });

  it('assertWechatCallbackSignature 在签名密钥缺失时拒绝通过', () => {
    const payload = {
      orderNo: 'RC123',
      orderType: 'recharge' as const,
      amountFen: 50000,
      transactionId: '4200001234202606101234567890',
      status: 'SUCCESS' as const,
    };
    configState['club.wechatCallbackSecret'] = '   ';

    expect(() =>
      service.assertWechatCallbackSignature(payload, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'IGNORED',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('assertWechatCallbackSignature 在签名不一致时拒绝通过', () => {
    const payload = {
      orderNo: 'SV123',
      orderType: 'service' as const,
      amountFen: 49900,
      transactionId: '4200001234202606109999999999',
      status: 'SUCCESS' as const,
    };

    expect(() =>
      service.assertWechatCallbackSignature(payload, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'BAD_SIGNATURE',
      }),
    ).toThrow(UnauthorizedException);
  });
});

function createSignedHeaders(
  service: ClubPaymentCallbackSignatureService,
  payload: {
    orderNo: string;
    orderType: 'recharge' | 'service';
    amountFen: number;
    transactionId: string;
    status: 'SUCCESS';
    paidAt?: string;
  },
  options?: {
    timestamp?: string;
    nonce?: string;
  },
): {
  timestamp: string;
  nonce: string;
  signature: string;
} {
  const timestamp = options?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options?.nonce ?? 'callback-nonce';

  return {
    timestamp,
    nonce,
    signature: service.buildWechatSignature({
      timestamp,
      nonce,
      payload,
    }),
  };
}
