import { createHash, randomBytes } from 'node:crypto';
import {
  buildScanOrderingQrTokenSecrets,
  decryptScanOrderingQrToken,
  encryptScanOrderingQrToken,
  hashScanOrderingQrToken,
  resolveScanOrderingQrTokenKeys,
  scanOrderingQrTokenPrefix,
} from './scan-ordering-qr-token-codec.utils';

/**
 * 扫码点餐桌码 token 编解码测试。
 *
 * 要守住的性质：
 * - 摘要稳定且不泄露明文（扫码解析查表只靠它）；
 * - 密文能被还原（商家端「重新下载 / 导出 / 打印」要靠它重建二维码内容，
 *   重建不出来就只能轮换 token，那等于让已印物料作废）；
 * - 密钥轮换后旧密文仍可解（否则历史桌码集体出不了图）；
 * - JWT_SECRET 派生前缀不能变（变了等于让未显式配密钥的部署里的历史密文作废）。
 */
describe('scan-ordering-qr-token-codec.utils', () => {
  /** 服务端桌码 token 形态：32 字节 base64url，43 位 */
  const TOKEN = 'NuSUjOX2ZBWZrLNx4C-nU-lCVKTAsL3xzLJNOkLlZvM';
  const CURRENT_KEY = randomBytes(32);
  const PREVIOUS_KEY = randomBytes(32);

  it('摘要稳定、定长且不等于明文', () => {
    const hash = hashScanOrderingQrToken(TOKEN);

    expect(hash).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(TOKEN);
    expect(hashScanOrderingQrToken(TOKEN)).toBe(hash);
  });

  it('tokenPrefix 只取前 8 位，不可用于还原', () => {
    expect(scanOrderingQrTokenPrefix(TOKEN)).toBe('NuSUjOX2');
  });

  it('密文可用主密钥还原出原 token', () => {
    const ciphertext = encryptScanOrderingQrToken(TOKEN, CURRENT_KEY);

    expect(ciphertext).not.toContain(TOKEN);
    expect(decryptScanOrderingQrToken(ciphertext, [CURRENT_KEY])).toBe(TOKEN);
  });

  it('密文每次都不同（IV 随机），但都能解开', () => {
    const first = encryptScanOrderingQrToken(TOKEN, CURRENT_KEY);
    const second = encryptScanOrderingQrToken(TOKEN, CURRENT_KEY);

    expect(first).not.toBe(second);
    expect(decryptScanOrderingQrToken(second, [CURRENT_KEY])).toBe(TOKEN);
  });

  it('密钥轮换后上一代密钥仍能解开历史密文', () => {
    const ciphertext = encryptScanOrderingQrToken(TOKEN, PREVIOUS_KEY);

    expect(
      decryptScanOrderingQrToken(ciphertext, [CURRENT_KEY, PREVIOUS_KEY]),
    ).toBe(TOKEN);
  });

  it('候选密钥都解不开时返回 null（由调用方报错，不能拿错 token 出图）', () => {
    const ciphertext = encryptScanOrderingQrToken(TOKEN, PREVIOUS_KEY);

    expect(decryptScanOrderingQrToken(ciphertext, [CURRENT_KEY])).toBeNull();
  });

  it('密文格式非法时抛错（与「解不开」区分，提示语不同）', () => {
    expect(() =>
      decryptScanOrderingQrToken('not-a-ciphertext', [CURRENT_KEY]),
    ).toThrow('桌码加密数据无效');
    expect(() => decryptScanOrderingQrToken('a.b', [CURRENT_KEY])).toThrow(
      '桌码加密数据无效',
    );
    expect(() => decryptScanOrderingQrToken('a.b.c.d', [CURRENT_KEY])).toThrow(
      '桌码加密数据无效',
    );
  });

  it('无可用密钥时密文为 null，摘要照写', () => {
    const secrets = buildScanOrderingQrTokenSecrets(TOKEN, {});

    expect(secrets.tokenHash).toBe(hashScanOrderingQrToken(TOKEN));
    expect(secrets.tokenPrefix).toBe('NuSUjOX2');
    expect(secrets.tokenCiphertext).toBeNull();
  });

  it('有显式密钥时同时产出摘要与密文', () => {
    const secrets = buildScanOrderingQrTokenSecrets(TOKEN, {
      current: CURRENT_KEY.toString('base64'),
    });

    expect(secrets.tokenCiphertext).not.toBeNull();
    expect(
      decryptScanOrderingQrToken(secrets.tokenCiphertext as string, [
        CURRENT_KEY,
      ]),
    ).toBe(TOKEN);
  });

  it('候选密钥按「当前 → 上一代 → JWT_SECRET 派生」去重', () => {
    const jwtSecret = 'test-jwt-secret';
    const derived = createHash('sha256')
      .update(`scan-ordering-qr-token:${jwtSecret}`)
      .digest();

    expect(
      resolveScanOrderingQrTokenKeys({
        current: CURRENT_KEY.toString('base64'),
        previous: PREVIOUS_KEY.toString('base64'),
        jwtSecret,
      }),
    ).toEqual([CURRENT_KEY, PREVIOUS_KEY, derived]);

    // 显式密钥重复时只保留一份
    expect(
      resolveScanOrderingQrTokenKeys({
        current: CURRENT_KEY.toString('base64'),
        previous: CURRENT_KEY.toString('base64'),
      }),
    ).toEqual([CURRENT_KEY]);
  });

  it('显式密钥与 JWT_SECRET 派生密钥不同（避免一处泄漏连带两种码）', () => {
    expect(
      resolveScanOrderingQrTokenKeys({
        current: CURRENT_KEY.toString('base64'),
        jwtSecret: 'test-jwt-secret',
      }),
    ).toHaveLength(2);
  });

  it('显式密钥长度非法时抛错（早失败，别写出解不开的密文）', () => {
    expect(() =>
      buildScanOrderingQrTokenSecrets(TOKEN, {
        current: randomBytes(16).toString('base64'),
      }),
    ).toThrow('桌码加密密钥必须为 32 字节 Base64 值');
  });
});
