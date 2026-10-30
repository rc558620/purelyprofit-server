/**
 * ClubWechatCallbackDecryptorService
 *
 * 负责微信支付 v3 回调报文的解密与解析。
 *
 * 算法：AEAD_AES_256_GCM
 *   - 密钥：APIv3Key（32 字节 ASCII → 32 字节 AES 密钥）
 *   - IV：resource.nonce（12 字节）
 *   - AAD：resource.associated_data
 *   - 密文：resource.ciphertext（Base64，末 16 字节为 GCM Tag）
 *
 * ⚠️【服务商模式改造 · 关键纠错】密钥来源只有两种，且**不再遍历门店密钥**：
 *
 *   1. 服务商模式（wechat.partner.enabled=true）：
 *      回调由**服务商的 APIv3 密钥**加密后发给服务商 —— 子商户（特约商户）在微信侧
 *      **不存在也不支持设置**自己的 APIv3 密钥。因此只用 `wechat.partner.apiV3Key`
 *      解密一次，失败即失败。
 *      ⚠️ 改造前「遍历所有门店密钥逐个尝试」的做法在服务商模式下 100% 失败，
 *      且会把「服务商密钥配错」误报成「报文被篡改」，排查方向完全跑偏，必须删除。
 *   2. 直连模式（旧链路，灰度回滚窗口内保留）：
 *      回调由门店自己的 APIv3 密钥加密，解密前拿不到 mchid，只能遍历候选密钥。
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
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import type {
  ClubWechatCallbackResourceDto,
  ClubWechatPaymentCallbackDto,
  WechatDecryptedTransaction,
} from './dto/club-wechat-callback.dto';

/** GCM 认证标签长度（字节） */
const GCM_TAG_LENGTH = 16;

/** APIv3 密钥长度（字节） */
const API_V3_KEY_LENGTH = 32;

/** 本次回调的收款主体（与身份服务口径一致：signMchId=签名主体，settleMchId=资金去向） */
export interface WechatCallbackMerchantIdentity {
  signMchId: string | null;
  settleMchId: string | null;
}

@Injectable()
export class ClubWechatCallbackDecryptorService {
  private readonly logger = new Logger(ClubWechatCallbackDecryptorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storesWechatPayService: StoresWechatPayService,
  ) {}

  /** 服务商模式是否开启；决定回调用哪一把 APIv3 密钥解密 */
  isPartnerMode(): boolean {
    return this.configService.get<boolean>('wechat.partner.enabled') === true;
  }

  /**
   * 解密回调报文中的 resource.ciphertext，返回交易详情。
   *
   * 服务商模式：只用服务商密钥解一次；
   * 直连模式：遍历门店密钥（历史行为，灰度回滚窗口内保留）。
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

    if (this.isPartnerMode()) {
      return this.decryptWithPartnerKey(resource);
    }
    return this.decryptWithStoreKeys(resource);
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

  /**
   * 从解密后的报文里取出本次收款的商户号身份。
   *
   * 服务商模式下微信会回传 sp_mchid / sub_mchid；直连模式下只有 mchid，
   * 此时它既是签名主体也是资金去向。
   */
  extractMerchantIdentity(
    tx: WechatDecryptedTransaction,
  ): WechatCallbackMerchantIdentity {
    if (this.isPartnerMode()) {
      return {
        signMchId: tx.sp_mchid?.trim() || null,
        settleMchId: tx.sub_mchid?.trim() || null,
      };
    }
    const mchId = tx.mchid?.trim() || null;
    return { signMchId: mchId, settleMchId: mchId };
  }

  // ─── 服务商模式解密 ───────────────────────────────────────────────────────

  /**
   * 用服务商 APIv3 密钥解密。
   *
   * 失败必须留下结构化日志：这里的失败只可能是「服务商密钥配错 / 被轮换」，
   * 不是「某个门店的密钥不匹配」，日志口径错了会把人往完全错误的方向带。
   */
  private decryptWithPartnerKey(
    resource: ClubWechatCallbackResourceDto,
  ): WechatDecryptedTransaction {
    const apiV3Key = this.configService
      .get<string>('wechat.partner.apiV3Key')
      ?.trim();

    if (!apiV3Key) {
      this.logger.error(
        '[partner] wechat.partner.apiV3Key 未配置，服务商模式下回调报文无法解密',
      );
      throw new UnauthorizedException(
        '微信支付回调解密失败：服务商 APIv3 密钥未配置',
      );
    }

    const decrypted = this.tryDecrypt(
      resource.ciphertext,
      resource.nonce,
      resource.associated_data ?? '',
      apiV3Key,
    );

    if (!decrypted) {
      this.logger.error(
        '[partner] 服务商 APIv3 密钥解密回调失败：密钥与微信侧不一致或已轮换，' +
          '请核对 WECHAT_PARTNER_API_V3_KEY（子商户没有自己的 APIv3 密钥，不要拿门店密钥顶替）',
      );
      throw new UnauthorizedException(
        '微信支付回调解密失败，服务商密钥不匹配或报文已损坏',
      );
    }

    return decrypted;
  }

  // ─── 直连模式解密（旧链路）───────────────────────────────────────────────

  /**
   * 遍历所有门店 APIv3 密钥尝试解密。
   *
   * 仅在 partner.enabled=false 的灰度回滚窗口内存在；服务商模式下不会走到这里。
   * 全失败时强制回源重试一次：密钥列表带短时缓存，商户刚轮换密钥时本实例可能
   * 仍持有旧列表（多实例部署下尤其如此），刷新可自愈。
   */
  private async decryptWithStoreKeys(
    resource: ClubWechatCallbackResourceDto,
  ): Promise<WechatDecryptedTransaction> {
    const apiV3Keys = await this.storesWechatPayService.listAllApiV3Keys();

    if (apiV3Keys.length === 0) {
      throw new UnauthorizedException(
        '系统中尚未配置任何微信收款商户，无法处理支付回调',
      );
    }

    let decrypted = this.tryDecryptWithKeys(resource, apiV3Keys);

    if (!decrypted) {
      const refreshedKeys =
        await this.storesWechatPayService.listAllApiV3Keys(true);
      if (refreshedKeys.length > 0) {
        this.logger.warn(
          '缓存中的 APIv3Key 全部解密失败，已强制刷新密钥列表并重试',
        );
        decrypted = this.tryDecryptWithKeys(resource, refreshedKeys);
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

  /**
   * 用给定的密钥集合依次尝试解密。
   *
   * 注意：这里**不能**提前用 mchid 缩小范围 —— 微信 v3 回调的 mchid 位于密文内，
   * 解密前无从得知本次回调属于哪个商户，只能遍历候选密钥。
   *
   * 始终尝试所有密钥（不 break），减少时序侧信道风险，仅保留首次成功的结果。
   */
  private tryDecryptWithKeys(
    resource: ClubWechatCallbackResourceDto,
    apiV3Keys: string[],
  ): WechatDecryptedTransaction | null {
    let decrypted: WechatDecryptedTransaction | null = null;

    for (const apiV3Key of apiV3Keys) {
      const candidate = this.tryDecrypt(
        resource.ciphertext,
        resource.nonce,
        resource.associated_data ?? '',
        apiV3Key,
      );
      if (candidate !== null && decrypted === null) {
        decrypted = candidate;
      }
    }

    return decrypted;
  }

  // ─── 底层加解密 ───────────────────────────────────────────────────────────

  /**
   * 尝试用指定 apiV3Key 解密密文。
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
      if (keyBuf.length !== API_V3_KEY_LENGTH) {
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
}
