import { createCipheriv } from 'node:crypto';
import { decryptResource } from './wechat-callback-crypto';

const API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节
const NONCE = 'abcdefghijkl'; // 12 字节
const ASSOCIATED_DATA = 'transaction';

interface PlainTransaction {
  out_trade_no: string;
  amount: { total: number };
}

/** 按微信 v3 规范构造 resource.ciphertext（密文 || 16 字节 GCM Tag 的 base64） */
const encryptResource = (payload: unknown, key: string): string => {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'utf8'),
    Buffer.from(NONCE, 'utf8'),
  );
  cipher.setAAD(Buffer.from(ASSOCIATED_DATA, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64');
};

describe('微信支付回调共享解密内核', () => {
  it('密钥 / nonce / AAD 一致时解出原始报文', () => {
    const payload: PlainTransaction = {
      out_trade_no: 'PM202606131200001234',
      amount: { total: 9900 },
    };

    const outcome = decryptResource<PlainTransaction>(
      API_V3_KEY,
      NONCE,
      ASSOCIATED_DATA,
      encryptResource(payload, API_V3_KEY),
    );

    expect(outcome).toEqual({ ok: true, payload });
  });

  it('密钥不匹配时返回 decrypt-failed，而不是抛异常', () => {
    const ciphertext = encryptResource(
      { out_trade_no: 'PM1', amount: { total: 1 } },
      'fedcba9876543210fedcba9876543210',
    );

    const outcome = decryptResource<PlainTransaction>(
      API_V3_KEY,
      NONCE,
      ASSOCIATED_DATA,
      ciphertext,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ kind: 'decrypt-failed' });
  });

  it('AAD 不匹配时同样按 decrypt-failed 处理', () => {
    const ciphertext = encryptResource(
      { out_trade_no: 'PM1', amount: { total: 1 } },
      API_V3_KEY,
    );

    const outcome = decryptResource<PlainTransaction>(
      API_V3_KEY,
      NONCE,
      'another-aad',
      ciphertext,
    );

    expect(outcome).toMatchObject({ ok: false, kind: 'decrypt-failed' });
  });

  it('密文不合法（不足一个 GCM Tag）时直接判失败', () => {
    const outcome = decryptResource<PlainTransaction>(
      API_V3_KEY,
      NONCE,
      ASSOCIATED_DATA,
      Buffer.from('short').toString('base64'),
    );

    expect(outcome).toEqual({ ok: false, kind: 'ciphertext-too-short' });
  });

  it('密钥长度不是 32 字节时回传实际字节数，便于日志定位配置错误', () => {
    const outcome = decryptResource<PlainTransaction>(
      'too-short-key',
      NONCE,
      ASSOCIATED_DATA,
      encryptResource(
        { out_trade_no: 'PM1', amount: { total: 1 } },
        API_V3_KEY,
      ),
    );

    expect(outcome).toEqual({
      ok: false,
      kind: 'invalid-key-length',
      keyByteLength: 13,
    });
  });

  it('明文不是合法 JSON 时按 decrypt-failed 处理', () => {
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(API_V3_KEY, 'utf8'),
      Buffer.from(NONCE, 'utf8'),
    );
    cipher.setAAD(Buffer.from(ASSOCIATED_DATA, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update('not-json', 'utf8'),
      cipher.final(),
    ]);
    const encoded = Buffer.concat([ciphertext, cipher.getAuthTag()]).toString(
      'base64',
    );

    const outcome = decryptResource<PlainTransaction>(
      API_V3_KEY,
      NONCE,
      ASSOCIATED_DATA,
      encoded,
    );

    expect(outcome).toMatchObject({ ok: false, kind: 'decrypt-failed' });
  });
});
