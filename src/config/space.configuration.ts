/**
 * `space` 配置块：空间码（呼叫服务 / 自助下单）二维码 token 加密密钥。
 *
 * 空间码改为「哈希查表」后，商家端「预览 / 下载」要用原始 token 重建二维码内容，
 * 因此明文以密文形式留存（`space_qr_codes.token_ciphertext`），本密钥即用于该密文。
 * 解析查表走 sha256 摘要，不需要本密钥 —— 未配置只影响重新出图，不影响扫码。
 */
export interface SpaceConfig {
  qrTokenEncryptionKey: string;
  /** 上一代空间码加密密钥（可选），用于密钥轮换后仍能解密历史空间码密文 */
  qrTokenEncryptionKeyPrevious: string;
}

/** 解析 `space` 配置块。 */
export function resolveSpaceConfig(): SpaceConfig {
  return {
    qrTokenEncryptionKey: process.env.SPACE_QR_TOKEN_ENCRYPTION_KEY ?? '',
    /**
     * 上一代空间码加密密钥（可选）。
     * 用于密钥轮换 / JWT_SECRET 轮换后仍能解密历史空间码的密文，
     * 否则商家端「预览 / 下载」会对全部历史空间码抛错。
     */
    qrTokenEncryptionKeyPrevious:
      process.env.SPACE_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '',
  };
}
