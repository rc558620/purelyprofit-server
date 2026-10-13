import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/** AES-256 要求的密钥字节数。 */
const MASTER_KEY_LENGTH = 32;

/** 64 位十六进制串（= 32 字节）形式的密钥。 */
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * scrypt 派生的固定盐值。
 *
 * 这里派生的是「配置里的主密钥」而非用户口令，不存在 per-user 彩虹表场景，
 * 使用固定盐即可，且保证同一配置在重启/多实例间派生结果一致。
 */
const KEY_DERIVATION_SALT = 'purelyprofit:wechat-pay:api-v3-key:v1';

/**
 * 微信支付敏感配置加密服务（Step 3: 0.5）
 *
 * 使用 AES-256-GCM 算法加密/解密微信支付 API v3 密钥
 * 加密密钥通过环境变量 WECHAT_PAY_KEY_ENCRYPTION_SECRET 管理（32 字节）
 *
 * 密钥解析优先级：
 *  1. 明文恰好 32 字节 —— 直接作为密钥（保持与历史部署兼容）
 *  2. 64 位十六进制 —— 按 hex 解码
 *  3. 其他长度 —— 用 scrypt 派生为 32 字节
 *
 * ⚠️ 历史上对非 32 字节的密钥采用「补零 / 截断」，会把短口令直接降格成弱密钥
 * 却不给出任何提示。第 3 条路径改为 scrypt 派生后，**若现网
 * WECHAT_PAY_KEY_ENCRYPTION_SECRET 不是恰好 32 字节，已存的历史密文将无法解密**，
 * 需要在微信收款配置页重新录入一次 APIv3 密钥。启动日志会出现对应警告。
 *
 * 若未配置 WECHAT_PAY_KEY_ENCRYPTION_SECRET，服务仍可实例化，
 * 但调用 encrypt/decrypt 时会抛出错误，避免阻塞应用启动。
 */
@Injectable()
export class WechatPayEncryptionService {
  private readonly logger = new Logger(WechatPayEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // GCM 推荐 IV 长度
  private readonly masterKey: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.get<string>('WECHAT_PAY_KEY_ENCRYPTION_SECRET');
    if (!secret) {
      this.logger.warn(
        'WECHAT_PAY_KEY_ENCRYPTION_SECRET 未配置，微信支付加密/解密功能不可用。' +
          '如需使用微信收款配置，请在环境变量中设置该值（32 字节密钥）.',
      );
      this.masterKey = null;
      return;
    }

    this.masterKey = this.deriveMasterKey(secret);
  }

  /**
   * 把环境变量中的密钥材料解析为 32 字节主密钥。
   *
   * 不再对非 32 字节的密钥「补零 / 截断」——补零等于把用户选的短口令
   * 直接当成 AES-256 密钥，实际强度远低于声明的 256 位，且此前完全无提示。
   */
  private deriveMasterKey(secret: string): Buffer {
    const trimmed = secret.trim();
    const raw = Buffer.from(trimmed, 'utf8');

    // 1. 明文恰好 32 字节：直接用，兼容历史部署
    if (raw.length === MASTER_KEY_LENGTH) {
      return raw;
    }

    // 2. 64 位十六进制
    if (HEX_KEY_PATTERN.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    // 3. 其他长度：scrypt 派生
    this.logger.warn(
      'WECHAT_PAY_KEY_ENCRYPTION_SECRET 不是 32 字节（当前 UTF-8 长度 ' +
        `${raw.length}），已改用 scrypt 派生主密钥。` +
        '注意：此前用该密钥加密的历史数据将无法解密，需重新录入 APIv3 密钥。' +
        '建议直接配置 32 字节（或 64 位十六进制）的密钥以避免此情况。',
    );
    return scryptSync(trimmed, KEY_DERIVATION_SALT, MASTER_KEY_LENGTH);
  }

  /**
   * 是否已配置加密密钥（用于调用方判断是否可用）
   */
  get isAvailable(): boolean {
    return this.masterKey !== null;
  }

  private requireKey(): Buffer {
    if (!this.masterKey) {
      throw new Error(
        'WECHAT_PAY_KEY_ENCRYPTION_SECRET 未配置，无法执行加密/解密操作。' +
          '请在环境变量中设置 WECHAT_PAY_KEY_ENCRYPTION_SECRET（32 字节密钥）.',
      );
    }
    return this.masterKey;
  }

  /**
   * 加密微信支付 API v3 密钥
   *
   * 返回格式：`iv:authTag:ciphertext`（全部 base64 编码）
   */
  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // 格式：iv:authTag:ciphertext
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /**
   * 解密微信支付 API v3 密钥
   *
   * @param encryptedText 格式：`iv:authTag:ciphertext`（base64 编码）
   */
  decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }

    const [ivBase64, authTagBase64, ciphertextBase64] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    const key = this.requireKey();
    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
