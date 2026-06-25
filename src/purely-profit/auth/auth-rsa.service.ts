import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, constants, privateDecrypt } from 'node:crypto';

/**
 * RSA 密钥对管理服务
 *
 * 职责：
 * 1. 启动时生成 RSA 2048-bit 密钥对，缓存在内存中
 * 2. 提供 PEM 格式公钥给前端（用于加密密码等敏感字段）
 * 3. 提供私钥解密能力，供 DTO 管道或 Service 层调用
 *
 * 安全设计：
 * - 密钥对仅在进程内存中持有，不落盘、不入库
 * - 进程重启后密钥对自动轮换，旧密钥加密的密文自动失效
 * - 前端每次提交前应重新获取公钥，避免使用过期公钥
 * - RSA_PKCS1_PADDING 与前端 jsencrypt 库的 PKCS1 v1.5 填充方式对齐
 */
@Injectable()
export class AuthRsaService {
  private readonly logger = new Logger(AuthRsaService.name);

  private publicKey: string;
  private privateKey: string;

  constructor(private readonly configService: ConfigService) {
    const envPublicKey = this.configService.get<string>('auth.rsaPublicKey');
    const envPrivateKey = this.configService.get<string>('auth.rsaPrivateKey');

    if (envPublicKey && envPrivateKey) {
      this.publicKey = envPublicKey;
      this.privateKey = envPrivateKey;
      this.logger.log('使用环境变量配置的 RSA 密钥对');
    } else {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
        },
      });
      this.publicKey = publicKey;
      this.privateKey = privateKey;
      this.logger.log('已生成 RSA 2048-bit 密钥对（进程重启后自动轮换）');
    }
  }

  /**
   * 获取 PEM 格式公钥（供前端加密使用）
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * 使用私钥解密 RSA 加密的密文
   *
   * 前端使用 jsencrypt 库以 PKCS1 v1.5 填充方式加密，
   * 后端使用对应的 RSA_PKCS1_PADDING 解密。
   *
   * @param encrypted Base64 编码的 RSA 密文
   * @returns 解密后的明文字符串
   * @throws 解密失败时抛出异常
   */
  decrypt(encrypted: string): string {
    if (!encrypted) {
      throw new Error('RSA 解密失败：密文为空');
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      const decrypted = privateDecrypt(
        {
          key: this.privateKey,
          padding: constants.RSA_PKCS1_PADDING,
        },
        buffer,
      );
      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.warn(
        `RSA 解密失败：${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error('RSA 解密失败，请重新获取公钥后重试');
    }
  }

  /**
   * 尝试解密密码字段
   *
   * 如果字段看起来是 RSA 加密的 Base64 字符串则解密；
   * 否则原样返回（兼容未加密的旧客户端）。
   *
   * 判断逻辑：RSA 2048 加密后的 Base64 输出固定为 344 字符，
   * 普通密码长度通常远小于此值。以 100 字符为阈值：
   * - 长度 >= 100 且为合法 Base64 → 视为加密密文，尝试解密
   * - 否则 → 原样返回（明文密码）
   */
  tryDecryptPassword(value: string): string {
    if (!value || value.length < 100) {
      return value;
    }

    // 快速校验是否为合法 Base64
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(value);
    if (!isBase64) {
      return value;
    }

    try {
      return this.decrypt(value);
    } catch (error: unknown) {
      // 解密失败时返回原始值，由后续业务校验处理
      this.logger.warn(
        `RSA 解密密码失败，回退到原始值: ${error instanceof Error ? error.message : String(error)}`,
      );
      return value;
    }
  }
}
