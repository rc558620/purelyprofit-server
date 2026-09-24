import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * 空间码 token 编解码（哈希查表 + 密文留存）。
 *
 * 为什么不能只存明文（改造前的问题）：
 * `space_qr_codes.token` 是明文 UUID，DB / 备份 / 日志泄漏后，攻击者可以拿着
 * 任意空间的 token 直接调 C 端「扫码呼叫服务 / 自助下单解析空间」接口，
 * 等价于拿到了全部空间的入场凭证，且与桌码 `tokenHash` 的口径不一致。
 *
 * 为什么不能只存哈希：
 * 商家端「预览 / 下载」要用**原始 token** 重建二维码内容。只存摘要就重建不出来，
 * 而每次预览重新生成 token 等于让已印刷物料作废 —— 那正是要防的事故。
 * 所以额外用 AES-256-GCM 把明文加密留存（`tokenCiphertext`）。
 *
 * 与桌码 `ScanOrderingQrService` 的编解码口径保持一致（iv.authTag.ciphertext，
 * base64url 拼接；GCM 自带校验，解错密钥只会失败不会产生错 token）。
 */

/** 空间码 token 的 sha256 摘要：解析查表只用摘要，明文不参与比对。 */
export function hashSpaceQrToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 明文 token 前 8 位：仅供工单排查对码，不可用于还原。 */
export function spaceQrTokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/** 一次建码 / 轮换要落库的 token 派生数据。 */
export interface SpaceQrTokenSecrets {
  /** 解析查表用的 sha256 摘要。 */
  tokenHash: string;
  /** 明文前 8 位，排查用。 */
  tokenPrefix: string;
  /** 加密留存的明文；无可用密钥时为 null（查表不依赖它）。 */
  tokenCiphertext: string | null;
}

/**
 * 生成建码 / 轮换时要落库的派生数据。
 *
 * 摘要必写；密文在**没有任何可用密钥**时留空 —— 建空间 / 轮换不应因为密钥缺失
 * 而失败（解析查表只靠摘要，密文只影响「重新出图」，届时可回退历史明文列）。
 * 密钥缺失本身由启动期告警暴露，不在这里静默吞掉。
 */
export function buildSpaceQrTokenSecrets(
  token: string,
  config: SpaceQrTokenKeyConfig,
): SpaceQrTokenSecrets {
  const [key] = resolveSpaceQrTokenKeys(config);
  return {
    tokenHash: hashSpaceQrToken(token),
    tokenPrefix: spaceQrTokenPrefix(token),
    tokenCiphertext: key ? encryptSpaceQrToken(token, key) : null,
  };
}

/** AES-256-GCM 加密，返回 `iv.authTag.ciphertext`（均为 base64url）。 */
export function encryptSpaceQrToken(token: string, key: Buffer): string {
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
 * @returns 明文 token；密文格式非法或所有候选密钥都解不开时返回 null，
 *          由调用方决定回退（当前阶段回退到历史明文列）。
 */
export function decryptSpaceQrToken(
  ciphertext: string,
  keys: Buffer[],
): string | null {
  const [encodedIv, encodedAuthTag, encodedToken, ...extraParts] =
    ciphertext.split('.');
  if (!encodedIv || !encodedAuthTag || !encodedToken || extraParts.length > 0) {
    return null;
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

export interface SpaceQrTokenKeyConfig {
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
 * 与桌码同源同构：密钥轮换后，轮换前生成的历史空间码仍能重新出图。
 */
export function resolveSpaceQrTokenKeys(
  config: SpaceQrTokenKeyConfig,
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
    throw new Error('空间码加密密钥必须为 32 字节 Base64 值');
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
  return createHash('sha256').update(`space-qr-token:${jwtSecret}`).digest();
}
