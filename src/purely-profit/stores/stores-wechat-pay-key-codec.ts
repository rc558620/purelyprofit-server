/**
 * 门店 APIv3 密钥密文的解密兼容层。
 *
 * 历史包袱集中在这里：早期存在「密文」与「明文」两种落库形态，解密失败时必须
 * 区分「主密钥配错」（真故障，必须告警并返回 null）与「历史明文」（兼容返回原值）。
 * 判断错了就会出现「支付回调静默解密失败、日志却显示密钥不匹配」的鬼打墙。
 *
 * @deprecated 服务商模式下商家不再提供 APIv3 密钥（子商户在微信侧没有该密钥），
 * 本文件随 partner.enabled=false 的旧直连链路一起废弃。
 */
import type { Logger } from '@nestjs/common';
import type { WechatPayEncryptionService } from './wechat-pay-encryption.service';

/** 密文格式 `iv:authTag:ciphertext` 的分段数。 */
const ENCRYPTED_PAYLOAD_PART_COUNT = 3;

/** base64（标准/URL 安全均可）片段判定，用于区分真密文与历史明文。 */
const BASE64_SEGMENT_PATTERN = /^[A-Za-z0-9+/\-_]+={0,2}$/;

/** 判定是否为 `iv:authTag:ciphertext` 形态的密文。 */
function looksLikeEncryptedPayload(value: string): boolean {
  const parts = value.split(':');
  return (
    parts.length === ENCRYPTED_PAYLOAD_PART_COUNT &&
    parts.every((part) => part.length > 0 && BASE64_SEGMENT_PATTERN.test(part))
  );
}

/**
 * 安全解密 apiV3KeyEnc。
 *
 * 仅在确认是「历史明文数据」时才回退返回原始值：明文不含密文分隔符，
 * WechatPayEncryptionService.decrypt 会抛 "Invalid encrypted format"。
 *
 * ⚠️ 若确认是密文却解密失败（主密钥未配置 / 轮换 / 配置错误），必须返回 null
 * 而不是把 `iv:authTag:ciphertext` 当作 APIv3Key 返回 —— 那样会让支付回调
 * 静默解密失败，且日志上表现为「密钥不匹配」，极难定位到真正的主密钥故障。
 */
export function decryptApiV3KeySafely(params: {
  encryptionService: WechatPayEncryptionService;
  apiV3KeyEnc: string;
  storeId: number;
  logger: Logger;
}): string | null {
  const { encryptionService, apiV3KeyEnc, storeId, logger } = params;

  if (!apiV3KeyEnc) return null;

  try {
    return encryptionService.decrypt(apiV3KeyEnc);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);

    if (looksLikeEncryptedPayload(apiV3KeyEnc)) {
      logger.error(
        `门店 ${storeId} 的 apiV3KeyEnc 解密失败，疑似 WECHAT_PAY_KEY_ENCRYPTION_SECRET 配置错误：${reason}`,
      );
      return null;
    }

    // 兼容迁移期间明文存储的历史数据
    logger.warn(
      `门店 ${storeId} 的 apiV3KeyEnc 非密文格式，按历史明文数据直接返回原始值`,
    );
    return apiV3KeyEnc;
  }
}
