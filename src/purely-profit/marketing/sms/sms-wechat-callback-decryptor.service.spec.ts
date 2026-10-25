import { UnauthorizedException } from '@nestjs/common';
import { createCipheriv, randomBytes } from 'node:crypto';
import { PlatformWechatCallbackDecryptorService } from '../../payments/platform-wechat-callback-decryptor.service';
import { SmsWechatCallbackDecryptorService } from './sms-wechat-callback-decryptor.service';

const API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节
const WRONG_KEY = 'ffffffffffffffffffffffffffffffff';
const ASSOCIATED_DATA = 'transaction';

function makeConfig(apiV3Key: string | undefined) {
  return {
    get: jest.fn((key: string) =>
      key === 'wechat.payApiV3Key' ? apiV3Key : undefined,
    ),
  };
}

/** 用与微信 v3 相同的方式构造密文（AES-256-GCM，末尾 16 字节 Tag） */
function encrypt(
  plaintext: unknown,
  key: string,
  nonce: string,
  aad: string,
): string {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
}

function buildPayload(apiV3Key: string) {
  const transaction = {
    out_trade_no: 'SM202610152030001234AB',
    transaction_id: 'wx-tx-1',
    trade_state: 'SUCCESS',
    mchid: '1900000001',
    appid: 'wxappid',
    amount: { total: 1000 },
  };
  const nonce = randomBytes(6).toString('hex');
  return {
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encrypt(transaction, apiV3Key, nonce, ASSOCIATED_DATA),
      nonce,
      associated_data: ASSOCIATED_DATA,
    },
  };
}

// 解密实现已上浮到 PlatformWechatCallbackDecryptorService，
// 这里用真实实现做委托方，覆盖「短信薄适配 + 平台解密」整条链路
const buildService = (
  apiV3Key: string | undefined,
): SmsWechatCallbackDecryptorService =>
  new SmsWechatCallbackDecryptorService(
    new PlatformWechatCallbackDecryptorService(makeConfig(apiV3Key) as never),
  );

describe('SmsWechatCallbackDecryptorService', () => {
  const service = buildService(API_V3_KEY);

  it('用平台 APIv3Key 解密回调报文（加解密往返）', () => {
    const tx = service.decryptCallback(buildPayload(API_V3_KEY));

    expect(tx.out_trade_no).toBe('SM202610152030001234AB');
    expect(tx.transaction_id).toBe('wx-tx-1');
    expect(tx.trade_state).toBe('SUCCESS');
    expect(tx.amount?.total).toBe(1000);
  });

  it('密钥不匹配时拒绝（门店密钥列表里不会有平台密钥，这正是与 club 解密器的区别）', () => {
    expect(() => service.decryptCallback(buildPayload(WRONG_KEY))).toThrow(
      UnauthorizedException,
    );
  });

  it('平台 APIv3Key 未配置时拒绝并提示联系平台管理员', () => {
    const noKeyService = buildService(undefined);

    expect(() =>
      noKeyService.decryptCallback(buildPayload(API_V3_KEY)),
    ).toThrow(/平台微信收款未配置/);
  });

  it('APIv3Key 长度不是 32 字节时拒绝（防误配成 16/24 字节密钥）', () => {
    const shortKeyService = buildService('short-key');

    expect(() =>
      shortKeyService.decryptCallback(buildPayload(API_V3_KEY)),
    ).toThrow(UnauthorizedException);
  });

  it('非 AEAD_AES_256_GCM 算法直接拒绝', () => {
    const payload = buildPayload(API_V3_KEY);
    (payload.resource as { algorithm: string }).algorithm = 'AES_128_CBC';

    expect(() => service.decryptCallback(payload)).toThrow(
      /不支持的回调加密算法/,
    );
  });

  it('密文被截断 / 损坏时拒绝', () => {
    const payload = buildPayload(API_V3_KEY);
    (payload.resource as { ciphertext: string }).ciphertext = 'AAAA';

    expect(() => service.decryptCallback(payload)).toThrow(
      UnauthorizedException,
    );
  });
});
