import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';

describe('ClubPaymentCallbackSignatureService', () => {
  let service: ClubPaymentCallbackSignatureService;

  const configState: Record<string, string | number> = {
    nodeEnv: 'development',
    'club.wechatCallbackMaxAgeSeconds': 300,
    'wechat.platformPublicKeyContent': '',
  };

  const configService = {
    get: jest.fn((key: string) => configState[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configState.nodeEnv = 'development';
    configState['club.wechatCallbackMaxAgeSeconds'] = 300;
    configState['wechat.platformPublicKeyContent'] = '';

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

  it('assertWechatCallbackSignature 在未配置平台公钥时仅校验时间戳有效性', () => {
    const rawBody = JSON.stringify({
      id: 'test-callback-id',
      event_type: 'TRANSACTION.SUCCESS',
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      timestamp,
      nonce: 'callback-nonce',
      signature: 'ANY_SIGNATURE', // 无平台公钥时不做 RSA 验签
      serial: 'CERT_SERIAL_001',
    };

    // 未配置平台公钥 → 跳过 RSA 验签，仅检查时间戳，应不抛出异常
    expect(() =>
      service.assertWechatCallbackSignature(rawBody, headers),
    ).not.toThrow();
  });

  it('assertWechatCallbackSignature 在生产环境缺少平台公钥时拒绝通过', () => {
    configState.nodeEnv = 'production';
    const rawBody = '{}';

    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'IGNORED',
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('assertWechatCallbackSignature 在回调已过期时拒绝通过', () => {
    const rawBody = '{}';
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 301);

    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp: expiredTimestamp,
        nonce: 'callback-nonce',
        signature: 'IGNORED',
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('assertWechatCallbackSignature 在缺少签名头时拒绝通过', () => {
    const rawBody = '{}';

    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp: undefined,
        nonce: 'callback-nonce',
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);

    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: undefined,
        signature: 'SIGNATURE',
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);

    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: undefined,
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('assertWechatCallbackSignature 在缺少 serial 头时发出警告但不阻断', () => {
    const rawBody = '{}';
    const timestamp = String(Math.floor(Date.now() / 1000));

    // serial 为 undefined 时应仅 warn，不抛出异常
    expect(() =>
      service.assertWechatCallbackSignature(rawBody, {
        timestamp,
        nonce: 'callback-nonce',
        signature: 'ANY_SIGNATURE',
        serial: undefined,
      }),
    ).not.toThrow();
  });
});
