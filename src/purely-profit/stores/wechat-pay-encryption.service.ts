import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 微信支付敏感配置加密服务（Step 3: 0.5）
 *
 * 使用 AES-256-GCM 算法加密/解密微信支付 API v3 密钥
 * 加密密钥通过环境变量 WECHAT_PAY_KEY_ENCRYPTION_SECRET 管理（必须 32 字节）
 *
 * 若未配置 WECHAT_PAY_KEY_ENCRYPTION_SECRET，服务仍可实例化，
 * 但调用 encrypt/decrypt 时会抛出错误，避免阻塞应用启动。
 */
@Injectable()
export class WechatPayEncryptionService {
  private readonly logger = new Logger(WechatPayEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // GCM 推荐 IV 长度
  private readonly authTagLength = 16; // GCM 认证标签长度
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

    // 将密钥扩展到 32 字节（SHA-256 简化版：直接截取或填充）
    const keyBuffer = Buffer.from(secret, 'utf8');
    if (keyBuffer.length < 32) {
      this.masterKey = Buffer.concat([
        keyBuffer,
        Buffer.alloc(32 - keyBuffer.length),
      ]);
    } else {
      this.masterKey = keyBuffer.subarray(0, 32);
    }
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
