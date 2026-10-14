import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * 扫码点餐桌码 token 编解码（哈希查表 + 密文留存）。
 *
 * 为什么两者都要存：
 * - `tokenHash`：C 端扫码解析只按摘要查表。DB / 备份 / 日志泄漏后，摘要无法
 *   被直接拿来当凭证，而明文可以 —— 任何人拿着明文就能伪装成这张桌台下单。
 * - `tokenCiphertext`：商家端「重新下载 / 批量导出 / 打印」要用**原始 token**
 *   重建二维码内容。只存摘要就重建不出来，而每次预览重新生成 token 等于让
 *   已印刷物料作废 —— 那正是要防的事故。所以用 AES-256-GCM 加密留存。
 *
 * 与空间码 `space-qr-token-codec.utils.ts` 同构（iv.authTag.ciphertext，
 * base64url 拼接；GCM 自带校验，解错密钥只会失败不会产生错 token），
 * 差异仅在**密钥派生前缀**与提示文案：两者必须派生到不同密钥，避免一张
 * 出库工的库泄漏同时影响桌码与空间码。
 *
 * ⚠️ 派生前缀 `scan-ordering-qr-token:` 是历史密文的一部分：改动会让全部
 * 未显式配置密钥的部署里已生成的 `tokenCiphertext` 解不开，且不可逆。
 */

/** 桌码 token 的 sha256 摘要：扫码解析查表只用摘要，明文不参与比对。 */
export function hashScanOrderingQrToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 明文 token 前 8 位：仅供工单排查对码，不可用于还原。 */
export function scanOrderingQrTokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/** 一次建码 / 轮换要落库的 token 派生数据。 */
export interface ScanOrderingQrTokenSecrets {
  /** 解析查表用的 sha256 摘要。 */
  tokenHash: string;
  /** 明文前 8 位，排查用。 */
  tokenPrefix: string;
  /** 加密留存的明文；无可用密钥时为 null。 */
  tokenCiphertext: string | null;
}

/**
 * 生成建码 / 轮换时要落库的派生数据。
 *
 * 摘要必写；密文在没有任何可用密钥时为 null，由调用方决定是降级（扫码不受
 * 影响）还是拒绝出码。
 */
export function buildScanOrderingQrTokenSecrets(
  token: string,
  config: ScanOrderingQrTokenKeyConfig,
): ScanOrderingQrTokenSecrets {
  const [key] = resolveScanOrderingQrTokenKeys(config);
  return {
    tokenHash: hashScanOrderingQrToken(token),
    tokenPrefix: scanOrderingQrTokenPrefix(token),
    tokenCiphertext: key ? encryptScanOrderingQrToken(token, key) : null,
  };
}

/** AES-256-GCM 加密，返回 `iv.authTag.ciphertext`（均为 base64url）。 */
export function encryptScanOrderingQrToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

/**
 * 依次尝试候选密钥解密。
 *
 * @returns 明文 token；所有候选密钥都解不开时返回 null，由调用方决定回退。
 * @throws 密文格式非法时抛错 —— 格式坏只能是被改写了，与「密钥轮换」是两类
 *         故障，提示语不同，不能合并成同一种 null。
 */
export function decryptScanOrderingQrToken(
  ciphertext: string,
  keys: Buffer[],
): string | null {
  const [encodedIv, encodedAuthTag, encodedToken, ...extraParts] =
    ciphertext.split('.');
  if (!encodedIv || !encodedAuthTag || !encodedToken || extraParts.length > 0) {
    throw new Error('桌码加密数据无效');
  }

  const iv = Buffer.from(encodedIv, 'base64url');
  const authTag = Buffer.from(encodedAuthTag, 'base64url');
  const encrypted = Buffer.from(encodedToken, 'base64url');

  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // 该候选密钥解不开（GCM 校验失败），继续尝试下一个
    }
  }

  return null;
}

export interface ScanOrderingQrTokenKeyConfig {
  /** 当前显式密钥（Base64，32 字节）。 */
  current?: string;
  /** 上一代显式密钥（轮换窗口内保留）。 */
  previous?: string;
  /** 兜底派生来源；两者都未显式配置时使用。 */
  jwtSecret?: string;
}

/**
 * 解密候选密钥（按优先级，已去重）：当前显式 → 上一代显式 → JWT_SECRET 派生。
 *
 * 密钥轮换后，轮换前生成的历史桌码仍能重新出图。
 */
export function resolveScanOrderingQrTokenKeys(
  config: ScanOrderingQrTokenKeyConfig,
): Buffer[] {
  const candidates = [
    readExplicitKey(config.current),
    readExplicitKey(config.previous),
    deriveKeyFromJwtSecret(config.jwtSecret),
  ].filter((key): key is Buffer => key !== null);

  const unique = new Map<string, Buffer>();
  for (const key of candidates) {
    unique.set(key.toString('hex'), key);
  }
  return [...unique.values()];
}

/** 读取显式配置的密钥；未配置返回 null，长度非法直接抛错（早失败，别写出解不开的密文）。 */
function readExplicitKey(encodedKey: string | undefined): Buffer | null {
  if (!encodedKey) {
    return null;
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('桌码加密密钥必须为 32 字节 Base64 值');
  }
  return key;
}

/**
 * 由 JWT_SECRET 派生的兜底密钥。
 *
 * 仅为兼容「从未显式配置过密钥」的历史部署保留：JWT_SECRET 一旦轮换，
 * 这些密文就再也解不开，因此生产环境必须显式配置独立密钥。
 */
function deriveKeyFromJwtSecret(jwtSecret: string | undefined): Buffer | null {
  if (!jwtSecret) {
    return null;
  }
  return createHash('sha256')
    .update(`scan-ordering-qr-token:${jwtSecret}`)
    .digest();
}
