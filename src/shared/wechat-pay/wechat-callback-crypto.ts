/**
 * 微信支付 API v3 回调报文解密（AEAD_AES_256_GCM）。
 *
 * 算法参数：
 *   - 密钥：APIv3Key（32 字节 ASCII → 32 字节 AES 密钥）
 *   - IV：resource.nonce（12 字节）
 *   - AAD：resource.associated_data（可选）
 *   - 密文：resource.ciphertext（Base64，末尾 16 字节为 GCM Tag）
 *
 * 只做**算法**，不做**密钥选择**：平台侧只有一把平台密钥，门店侧要按服务商 /
 * 直连两种模式挑候选密钥，那属于业务边界，留在各自解密的 service 里。
 * 这里返回失败原因而不是抛异常，是为了让两侧保留各自既有的日志口径 ——
 * 「服务商密钥配错」和「某门店密钥不匹配」必须给出完全不同的排查方向。
 */
import { createDecipheriv } from 'node:crypto';

/** GCM 认证标签长度（字节） */
export const WECHAT_GCM_TAG_LENGTH = 16;

/** APIv3 密钥长度（字节） */
export const WECHAT_API_V3_KEY_LENGTH = 32;

export type WechatResourceDecryptOutcome<T> =
  | { ok: true; payload: T }
  | {
      ok: false;
      kind: 'ciphertext-too-short';
    }
  | {
      ok: false;
      kind: 'invalid-key-length';
      /** 实际密钥字节数，便于日志直接指出配置问题 */
      keyByteLength: number;
    }
  | {
      ok: false;
      kind: 'decrypt-failed';
      /** 白名单化的排查摘要，不含原始错误文本、密钥、密文与内部路径 */
      errorMessage: string;
    };

/**
 * 尝试用指定 apiV3Key 解密密文。
 *
 * 失败（密文过短 / 密钥长度不对 / GCM 认证失败 / JSON 解析失败）一律返回
 * `ok: false`，不抛异常：调用方需要「试遍所有候选密钥」而不是在第一个失败处中断。
 */
export function decryptResource<T>(
  apiV3Key: string,
  nonce: string,
  associatedData: string,
  ciphertext: string,
): WechatResourceDecryptOutcome<T> {
  try {
    const ciphertextBuf = Buffer.from(ciphertext, 'base64');
    if (ciphertextBuf.length <= WECHAT_GCM_TAG_LENGTH) {
      return { ok: false, kind: 'ciphertext-too-short' };
    }

    const ciphertextBody = ciphertextBuf.subarray(
      0,
      ciphertextBuf.length - WECHAT_GCM_TAG_LENGTH,
    );
    const authTag = ciphertextBuf.subarray(
      ciphertextBuf.length - WECHAT_GCM_TAG_LENGTH,
    );

    // APIv3Key 直接作为 32 字节 AES 密钥（UTF-8 编码）
    const keyBuf = Buffer.from(apiV3Key, 'utf8');
    if (keyBuf.length !== WECHAT_API_V3_KEY_LENGTH) {
      return {
        ok: false,
        kind: 'invalid-key-length',
        keyByteLength: keyBuf.length,
      };
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyBuf,
      Buffer.from(nonce, 'utf8'),
    );
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));

    const plaintext = Buffer.concat([
      decipher.update(ciphertextBody),
      decipher.final(),
    ]).toString('utf8');

    return { ok: true, payload: JSON.parse(plaintext) as T };
  } catch (error: unknown) {
    // 密钥不对 / GCM 认证失败 / 明文不是合法 JSON。
    // 原始 error.message 可能携带 Node 内部路径或密文片段，且会直接进业务日志，
    // 因此只回传可枚举的排查分类，不把原始错误文本带出本层。
    const errorMessage =
      error instanceof SyntaxError
        ? '明文不是合法 JSON'
        : 'GCM 认证失败或解密过程异常（原始错误已省略）';
    return { ok: false, kind: 'decrypt-failed', errorMessage };
  }
}
