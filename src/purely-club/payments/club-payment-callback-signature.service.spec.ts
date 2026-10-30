import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';

describe('ClubPaymentCallbackSignatureService', () => {
  let service: ClubPaymentCallbackSignatureService;

  const configState: Record<string, string | number | boolean> = {
    nodeEnv: 'development',
    'club.wechatCallbackMaxAgeSeconds': 300,
    'wechat.platformPublicKeyContent': '',
    // 本地调试环境默认允许跳过 RSA 验签；其它环境默认 false（fail-closed）
    'wechat.allowInsecureCallback': true,
  };

  const configService = {
    get: jest.fn((key: string) => configState[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configState.nodeEnv = 'development';
    configState['club.wechatCallbackMaxAgeSeconds'] = 300;
    configState['wechat.platformPublicKeyContent'] = '';
    configState['wechat.allowInsecureCallback'] = true;

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

  it('显式允许调试降级时，未配置平台公钥仅校验时间戳有效性', () => {
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

  it('非生产环境未显式允许时同样拒绝跳过验签（fail-closed）', () => {
    configState['wechat.allowInsecureCallback'] = false;

    expect(() =>
      service.assertWechatCallbackSignature('{}', {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'FORGED',
        serial: 'CERT_SERIAL_001',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('生产环境即便误开 allowInsecureCallback 也拒绝跳过验签', () => {
    configState.nodeEnv = 'production';
    configState['wechat.allowInsecureCallback'] = true;

    expect(() =>
      service.assertWechatCallbackSignature('{}', {
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: 'callback-nonce',
        signature: 'FORGED',
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

  describe('服务商模式下的「按链路取平台证书」', () => {
    const globalKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const partnerKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

    const globalPublicPem = globalKeyPair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const globalPrivatePem = globalKeyPair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const partnerPublicPem = partnerKeyPair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const partnerPrivatePem = partnerKeyPair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const rawBody = JSON.stringify({ id: 'partner-callback-id' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'partner-nonce';

    const buildSignature = (privatePem: string): string =>
      createSign('RSA-SHA256')
        .update(`${timestamp}\n${nonce}\n${rawBody}\n`)
        .sign(privatePem, 'base64');

    const headersWith = (signature: string) => ({
      timestamp,
      nonce,
      signature,
      serial: 'CERT_SERIAL_001',
    });

    beforeEach(() => {
      configState['wechat.platformPublicKeyContent'] = globalPublicPem;
      configState['wechat.partner.platformPublicKeyContent'] = partnerPublicPem;
      configState['wechat.partner.enabled'] = true;
    });

    afterEach(() => {
      configState['wechat.partner.enabled'] = false;
      delete configState['wechat.partner.platformPublicKeyContent'];
    });

    it('club 链路在服务商模式下使用服务商维度的平台证书验签', () => {
      expect(() =>
        service.assertWechatCallbackSignature(
          rawBody,
          headersWith(buildSignature(partnerPrivatePem)),
          'club',
        ),
      ).not.toThrow();
    });

    it('同一报文走 platform 链路时应使用另一份证书，验签必然失败', () => {
      expect(() =>
        service.assertWechatCallbackSignature(
          rawBody,
          headersWith(buildSignature(partnerPrivatePem)),
          'platform',
        ),
      ).toThrow(UnauthorizedException);
    });

    it('服务商模式关闭时 club 链路回落全局平台证书，行为与改造前一致', () => {
      configState['wechat.partner.enabled'] = false;

      expect(() =>
        service.assertWechatCallbackSignature(
          rawBody,
          headersWith(buildSignature(globalPrivatePem)),
          'club',
        ),
      ).not.toThrow();
    });
  });
});
