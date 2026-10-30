/**
 * 平台收款回调的 v3 报文解密（商家 / 门店付钱给平台的链路通用）。
 *
 * 与 club 解密器（`ClubWechatCallbackDecryptorService`）的区别（服务商改造后已变化）：
 *   - 平台收款（b/c）走**平台商户号**，APIv3Key 来自环境变量 `WECHAT_PAY_API_V3_KEY`；
 *   - C 端门店收款（a）在**服务商模式**下回调由**服务商** APIv3 密钥加密
 *     （`wechat.partner.apiV3Key`），子商户在微信侧没有自己的密钥；
 *   - 只有 partner.enabled=false 的旧直连链路才是「每门店各自商户号、遍历门店密钥」。
 * 因此两条链路的密钥都不在对方的候选集里，必须各用各的解密器，不能互换。
 *
 * 算法：AEAD_AES_256_GCM
 *   - 密钥：平台 APIv3Key（32 字节 ASCII）
 *   - IV：resource.nonce（12 字节）
 *   - AAD：resource.associated_data（可选）
 *   - 密文：resource.ciphertext（Base64，末尾 16 字节为 GCM Tag）
 */
import { createDecipheriv } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WechatDecryptedTransaction } from '../../purely-club/payments/dto/club-wechat-callback.dto';

export interface WechatCallbackResourcePayload {
  resource: {
    algorithm: string;
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  };
}

/** GCM Tag 固定 16 字节 */
const GCM_TAG_LENGTH = 16;

@Injectable()
export class PlatformWechatCallbackDecryptorService {
  private readonly logger = new Logger(
    PlatformWechatCallbackDecryptorService.name,
  );

  constructor(private readonly configService: ConfigService) {}

  /**
   * 解密回调报文中的 resource.ciphertext，返回交易详情。
   *
   * 单一平台密钥，无需遍历试解：解不开就说明密钥配错或报文被篡改，
   * 直接拒绝（微信会重试投递，不会丢单）。
   */
  decryptCallback(
    payload: WechatCallbackResourcePayload,
  ): WechatDecryptedTransaction {
    const resource = payload.resource;

    if (resource.algorithm !== 'AEAD_AES_256_GCM') {
      throw new UnauthorizedException(
        `不支持的回调加密算法: ${resource.algorithm}`,
      );
    }

    const apiV3Key = this.getPlatformApiV3Key();
    const decrypted = this.tryDecrypt(
      resource.ciphertext,
      resource.nonce,
      resource.associated_data ?? '',
      apiV3Key,
    );

    if (!decrypted) {
      this.logger.warn(
        '平台 APIv3Key 无法解密回调报文，可能是密钥配置错误或报文被篡改',
      );
      throw new UnauthorizedException(
        '平台收款回调解密失败，平台密钥不匹配或报文已损坏',
      );
    }

    return decrypted;
  }

  private getPlatformApiV3Key(): string {
    const key = this.configService.get<string>('wechat.payApiV3Key')?.trim();
    if (!key) {
      // 平台配置缺失属于部署事故：商家无法自查，直接拒绝并留明确日志
      this.logger.error(
        'WECHAT_PAY_API_V3_KEY 未配置，平台收款回调无法解密，请检查平台微信支付配置',
      );
      throw new UnauthorizedException(
        '平台微信收款未配置，无法处理支付回调，请联系平台管理员',
      );
    }
    return key;
  }

  /**
   * 尝试用平台 APIv3Key 解密密文。
   * 解密失败（密钥错误 / GCM 认证失败）时返回 null，不抛出异常。
   */
  private tryDecrypt(
    ciphertextBase64: string,
    nonce: string,
    associatedData: string,
    apiV3Key: string,
  ): WechatDecryptedTransaction | null {
    try {
      const ciphertextBuf = Buffer.from(ciphertextBase64, 'base64');
      if (ciphertextBuf.length <= GCM_TAG_LENGTH) {
        return null;
      }

      const ciphertext = ciphertextBuf.subarray(
        0,
        ciphertextBuf.length - GCM_TAG_LENGTH,
      );
      const authTag = ciphertextBuf.subarray(
        ciphertextBuf.length - GCM_TAG_LENGTH,
      );

      // APIv3Key 直接作为 32 字节 AES 密钥（UTF-8 编码）
      const keyBuf = Buffer.from(apiV3Key, 'utf8');
      if (keyBuf.length !== 32) {
        this.logger.error(
          `平台 APIv3Key 长度非法（${keyBuf.length} 字节，应为 32），请检查 WECHAT_PAY_API_V3_KEY`,
        );
        return null;
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        keyBuf,
        Buffer.from(nonce, 'utf8'),
      );
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');

      return JSON.parse(plaintext) as WechatDecryptedTransaction;
    } catch (error: unknown) {
      // 密钥不对或 GCM 认证失败，返回 null
      this.logger.warn(
        `平台收款回调 AES-GCM 解密失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
