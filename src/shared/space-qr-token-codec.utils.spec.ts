import { createHash, randomBytes } from 'node:crypto';
import {
  buildSpaceQrTokenSecrets,
  decryptSpaceQrToken,
  encryptSpaceQrToken,
  hashSpaceQrToken,
  resolveSpaceQrTokenKeys,
  spaceQrTokenPrefix,
} from './space-qr-token-codec.utils';

/**
 * 空间码 token 编解码测试。
 *
 * 要守住的性质：
 * - 摘要稳定且不泄露明文（解析查表只靠它）；
 * - 密文能被还原（商家端「预览 / 下载」要靠它重建二维码内容，
 *   重建不出来就只能轮换 token，那等于让已印物料作废）；
 * - 密钥轮换后旧密文仍可解（否则历史空间码集体出不了图）；
 * - 密钥缺失时降级而非崩溃（解析查表不依赖密文，建空间不该因此失败）。
 */
describe('space-qr-token-codec.utils', () => {
  /** 服务端空间码 token 形态：randomUUID()，36 位 */
  const TOKEN = '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e';
  const CURRENT_KEY = randomBytes(32);
  const PREVIOUS_KEY = randomBytes(32);

  it('摘要稳定、定长且不等于明文', () => {
    const hash = hashSpaceQrToken(TOKEN);

    expect(hash).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(TOKEN);
    expect(hashSpaceQrToken(TOKEN)).toBe(hash);
  });

  it('tokenPrefix 只取前 8 位，不可用于还原', () => {
    expect(spaceQrTokenPrefix(TOKEN)).toBe('7f1c2f52');
  });

  it('密文可用主密钥还原出原 token', () => {
    const ciphertext = encryptSpaceQrToken(TOKEN, CURRENT_KEY);

    expect(ciphertext).not.toContain(TOKEN);
    expect(decryptSpaceQrToken(ciphertext, [CURRENT_KEY])).toBe(TOKEN);
  });

  it('密文每次都不同（IV 随机），但都能解开', () => {
    const first = encryptSpaceQrToken(TOKEN, CURRENT_KEY);
    const second = encryptSpaceQrToken(TOKEN, CURRENT_KEY);

    expect(first).not.toBe(second);
    expect(decryptSpaceQrToken(second, [CURRENT_KEY])).toBe(TOKEN);
  });

  it('密钥轮换后上一代密钥仍能解开历史密文', () => {
    const ciphertext = encryptSpaceQrToken(TOKEN, PREVIOUS_KEY);

    expect(decryptSpaceQrToken(ciphertext, [CURRENT_KEY, PREVIOUS_KEY])).toBe(
      TOKEN,
    );
  });

  it('候选密钥都解不开时返回 null（由调用方回退，不能拿错 token 出图）', () => {
    const ciphertext = encryptSpaceQrToken(TOKEN, PREVIOUS_KEY);

    expect(decryptSpaceQrToken(ciphertext, [CURRENT_KEY])).toBeNull();
  });

  it('密文格式非法时返回 null', () => {
    expect(decryptSpaceQrToken('not-a-ciphertext', [CURRENT_KEY])).toBeNull();
    expect(decryptSpaceQrToken('a.b', [CURRENT_KEY])).toBeNull();
    expect(decryptSpaceQrToken('a.b.c.d', [CURRENT_KEY])).toBeNull();
  });

  it('无可用密钥时降级：摘要照写、密文为 null', () => {
    const secrets = buildSpaceQrTokenSecrets(TOKEN, {});

    expect(secrets.tokenHash).toBe(hashSpaceQrToken(TOKEN));
    expect(secrets.tokenPrefix).toBe('7f1c2f52');
    expect(secrets.tokenCiphertext).toBeNull();
  });

  it('有显式密钥时同时产出摘要与密文', () => {
    const secrets = buildSpaceQrTokenSecrets(TOKEN, {
      current: CURRENT_KEY.toString('base64'),
    });

    expect(secrets.tokenCiphertext).not.toBeNull();
    expect(
      decryptSpaceQrToken(secrets.tokenCiphertext as string, [CURRENT_KEY]),
    ).toBe(TOKEN);
  });

  it('候选密钥按「当前 → 上一代 → JWT_SECRET 派生」去重', () => {
    const jwtSecret = 'test-jwt-secret';
    const derived = createHash('sha256')
      .update(`space-qr-token:${jwtSecret}`)
      .digest();

    expect(
      resolveSpaceQrTokenKeys({
        current: CURRENT_KEY.toString('base64'),
        previous: PREVIOUS_KEY.toString('base64'),
        jwtSecret,
      }),
    ).toEqual([CURRENT_KEY, PREVIOUS_KEY, derived]);

    // 显式密钥重复时只保留一份
    expect(
      resolveSpaceQrTokenKeys({
        current: CURRENT_KEY.toString('base64'),
        previous: CURRENT_KEY.toString('base64'),
      }),
    ).toEqual([CURRENT_KEY]);
  });

  it('显式密钥长度非法时抛错（早失败，别写出解不开的密文）', () => {
    expect(() =>
      buildSpaceQrTokenSecrets(TOKEN, {
        current: randomBytes(16).toString('base64'),
      }),
    ).toThrow('空间码加密密钥必须为 32 字节 Base64 值');
  });
});
