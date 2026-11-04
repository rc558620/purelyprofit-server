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
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptResource } from '../../shared/wechat-pay/wechat-callback-crypto';
import type { WechatDecryptedTransaction } from '../../purely-club/payments/dto/club-wechat-callback.dto';

export interface WechatCallbackResourcePayload {
  resource: {
    algorithm: string;
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  };
}

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
    const outcome = decryptResource<WechatDecryptedTransaction>(
      apiV3Key,
      nonce,
      associatedData,
      ciphertextBase64,
    );

    if (outcome.ok) {
      return outcome.payload;
    }

    // 平台侧只有一把密钥：长度非法属于部署事故，必须留下可定位的 error 日志
    if (outcome.kind === 'invalid-key-length') {
      this.logger.error(
        `平台 APIv3Key 长度非法（${outcome.keyByteLength} 字节，应为 32），请检查 WECHAT_PAY_API_V3_KEY`,
      );
      return null;
    }
    if (outcome.kind === 'decrypt-failed') {
      this.logger.warn(
        `平台收款回调 AES-GCM 解密失败: ${outcome.errorMessage}`,
      );
    }
    return null;
  }
}
