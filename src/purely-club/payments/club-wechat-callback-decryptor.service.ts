/**
 * ClubWechatCallbackDecryptorService
 *
 * 负责微信支付 v3 回调报文的解密与解析。
 *
 * 算法：AEAD_AES_256_GCM
 *   - 密钥：门店的 APIv3Key（32 字节 ASCII → SHA256 → 32 字节密钥）
 *   - IV：resource.nonce（12 字节）
 *   - AAD：resource.associated_data（可选）
 *   - 密文：resource.ciphertext（Base64，末尾 16 字节为 GCM Tag）
 *
 * 参考文档：
 *   https://pay.weixin.qq.com/docs/merchant/development/interface-rules/sensitive-data-encryption.html
 */
import { createDecipheriv } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import type {
  ClubWechatPaymentCallbackDto,
  WechatDecryptedTransaction,
} from './dto/club-wechat-callback.dto';

@Injectable()
export class ClubWechatCallbackDecryptorService {
  private readonly logger = new Logger(ClubWechatCallbackDecryptorService.name);

  constructor(
    private readonly storesWechatPayService: StoresWechatPayService,
  ) {}

  /**
   * 解密回调报文中的 resource.ciphertext，返回交易详情。
   *
   * 步骤：
   *  1. 从密文中解析出 mchid（先做一次无密钥的粗解，不行则要求前置头传 mchid）
   *     → 微信实际上在 ciphertext 解密后才有 mchid，因此需要从 HTTP 请求头
   *       Wechatpay-Serial 反查或通过配置的唯一商户号定位。
   *     → 本实现通过解密后得到的 mchid 反查 apiV3Key，若有多个商户则需要遍历。
   *     → 实用做法：先用系统中所有已配置的 apiV3Key 依次尝试解密，成功即可。
   *  2. 以 AEAD_AES_256_GCM 解密密文。
   *  3. 解析 JSON，校验 trade_state === 'SUCCESS'。
   */
  async decryptCallback(
    payload: ClubWechatPaymentCallbackDto,
  ): Promise<WechatDecryptedTransaction> {
    const { resource } = payload;

    if (resource.algorithm !== 'AEAD_AES_256_GCM') {
      throw new UnauthorizedException(
        `不支持的回调加密算法: ${resource.algorithm}`,
      );
    }

    // 尝试解密：遍历所有已配置商户的 apiV3Key
    const apiV3Keys = await this.storesWechatPayService.listAllApiV3Keys();

    if (apiV3Keys.length === 0) {
      throw new UnauthorizedException(
        '系统中尚未配置任何微信收款商户，无法处理支付回调',
      );
    }

    let decrypted: WechatDecryptedTransaction | null = null;

    // 始终尝试所有密钥（不 break），减少时序侧信道风险
    for (const apiV3Key of apiV3Keys) {
      const candidate = this.tryDecrypt(
        resource.ciphertext,
        resource.nonce,
        resource.associated_data ?? '',
        apiV3Key,
      );
      // 仅保留首次成功解密的结果
      if (candidate !== null && decrypted === null) {
        decrypted = candidate;
      }
    }

    if (!decrypted) {
      this.logger.warn(
        '所有已配置 APIv3Key 均无法解密微信回调报文，可能是密钥错误或报文被篡改',
      );
      throw new UnauthorizedException(
        '微信支付回调解密失败，密钥不匹配或报文已损坏',
      );
    }

    return decrypted;
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /**
   * 尝试用指定 apiV3Key 解密密文。
   * 解密失败（密钥错误 / 认证失败）时返回 null，不抛出异常。
   */
  private tryDecrypt(
    ciphertextBase64: string,
    nonce: string,
    associatedData: string,
    apiV3Key: string,
  ): WechatDecryptedTransaction | null {
    try {
      const ciphertextBuf = Buffer.from(ciphertextBase64, 'base64');

      // GCM Tag 为末尾 16 字节
      const GCM_TAG_LENGTH = 16;
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
        `微信回调 AES-GCM 解密失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 从已解密的交易信息中提取业务所需字段，并校验交易状态。
   */
  validateAndExtract(tx: WechatDecryptedTransaction): {
    orderNo: string;
    transactionId: string;
    amountFen: number;
    paidAt: string | undefined;
  } {
    if (tx.trade_state !== 'SUCCESS') {
      throw new InternalServerErrorException(
        `微信支付状态非成功: ${tx.trade_state}，跳过落账`,
      );
    }

    if (!tx.out_trade_no) {
      throw new InternalServerErrorException('微信回调缺少 out_trade_no');
    }

    if (!tx.transaction_id) {
      throw new InternalServerErrorException('微信回调缺少 transaction_id');
    }

    // 使用订单总金额（含积分/优惠券抵扣前的金额），与 draft.amountFen 口径一致
    // payer_total 是用户实付金额（扣除了优惠券等），与 draft.amountFen 不一致
    const amountFen = tx.amount?.total ?? 0;

    return {
      orderNo: tx.out_trade_no,
      transactionId: tx.transaction_id,
      amountFen,
      paidAt: tx.success_time,
    };
  }
}
