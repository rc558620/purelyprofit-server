import {
  resolveAllowPrivateNetwork,
  sanitizePublicBaseUrl,
} from '../../shared/qr-public-url.utils';

/**
 * C 端扫码二维码协议（扫码点餐桌码 / 空间码）。
 *
 * 载荷从「裸 token / 自定义协议」升级为「稳定 URL」，以复用微信
 * 「扫普通链接二维码打开小程序」能力，实现「微信扫一扫直接唤起小程序」：
 *
 *   {scanQrBaseUrl}/t/{qrToken}     扫码点餐桌码
 *   {scanQrBaseUrl}/p/{spaceToken}  空间码（呼叫服务 / 自助下单）
 *
 * ⚠️ 路径段必须与前端 `purelyClub/src/utils/scanPayload.ts` 的
 * `SCAN_PATH_KINDS` 保持一致，否则前端无法按路径粗分扫码类型。
 *
 * ⚠️ 采用独立域名配置（`SCAN_QR_BASE_URL`）而不是复用邀请二维码的
 * `CLUB_PUBLIC_BASE_URL`：「扫普通链接二维码」按「域名 + 路径前缀」配置规则，
 * 若两者共用域名，一旦规则配成整个域名前缀，会连带把 `{base}/i/...`
 * 也唤起小程序，导致邀请二维码无法再落地到 H5 页面。
 *
 * ⚠️ 未配置域名时回退历史格式（桌码裸 token、空间码 purelyclub:// 自定义协议），
 * 保证已印刷二维码与本机联调完全不受影响；生产环境下 localhost / 内网地址
 * 会被拒绝并回退，不会把不可达地址写进物料。
 *
 * 本模块为纯函数，不依赖 Nest DI；域名由调用方从 ConfigService 读取后传入。
 */

/** 扫码点餐桌码路径段。必须与前端 scanPayload.ts 的 SCAN_PATH_KINDS.table 一致。 */
export const SCAN_QR_TABLE_PATH = 't';
/** 空间码路径段。必须与前端 scanPayload.ts 的 SCAN_PATH_KINDS.space 一致。 */
export const SCAN_QR_SPACE_PATH = 'p';

/** 空间码历史自定义协议前缀（微信不识别，仅保证旧物料可扫）。 */
const SPACE_LEGACY_SCHEME = 'purelyclub://space-scan';

/** 桌码 token 形态：base64url，至少 16 位（服务端为 32 字节 base64url，共 43 位）。 */
const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

/** 空间码 token 形态：UUID，允许字母数字与连字符。 */
const SPACE_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

export interface BuildScanQrPayloadOptions {
  /** 扫码公共域名，如 https://scan.purelyprofit.com；空值时回退 legacy 格式。 */
  baseUrl?: string;
  /**
   * 是否放行 localhost / 内网地址（本机联调用）。
   * 默认：生产环境禁止，其他环境放行。
   */
  allowPrivateNetwork?: boolean;
}

/**
 * 构建扫码点餐桌码载荷。
 *
 * - 未配置域名（或域名非法）→ 回退裸 token（历史格式）；
 * - 配置域名 → `{baseUrl}/t/{token}`。
 *
 * 返回空串表示 token 本身非法，调用方应视为内部错误（token 由本服务生成）。
 */
export function buildScanOrderingTableQrPayload(
  token: string,
  options: BuildScanQrPayloadOptions = {},
): string {
  const normalizedToken = normalizeToken(token, TABLE_TOKEN_PATTERN);
  if (!normalizedToken) {
    return '';
  }

  const baseUrl = sanitizeScanBaseUrl(options);
  if (!baseUrl) {
    return normalizedToken;
  }

  return `${baseUrl}/${SCAN_QR_TABLE_PATH}/${normalizedToken}`;
}

/**
 * 构建空间码载荷。
 *
 * - 未配置域名（或域名非法）→ 回退历史自定义协议，保证已印刷物料仍可扫；
 * - 配置域名 → `{baseUrl}/p/{token}`。
 */
export function buildSpaceQrPayload(
  token: string,
  options: BuildScanQrPayloadOptions = {},
): string {
  const normalizedToken = normalizeToken(token, SPACE_TOKEN_PATTERN);
  if (!normalizedToken) {
    return '';
  }

  const baseUrl = sanitizeScanBaseUrl(options);
  if (!baseUrl) {
    return `${SPACE_LEGACY_SCHEME}?token=${encodeURIComponent(normalizedToken)}`;
  }

  return `${baseUrl}/${SCAN_QR_SPACE_PATH}/${normalizedToken}`;
}

function sanitizeScanBaseUrl(options: BuildScanQrPayloadOptions): string {
  return sanitizePublicBaseUrl(
    options.baseUrl,
    resolveAllowPrivateNetwork(options.allowPrivateNetwork),
  );
}

function normalizeToken(token: string, pattern: RegExp): string {
  const normalized = typeof token === 'string' ? token.trim() : '';
  return pattern.test(normalized) ? normalized : '';
}
