import QRCode from 'qrcode';

/**
 * 邀请二维码协议（store invite code QR protocol）。
 *
 * 二维码载荷从「裸邀请码」升级为「稳定 URL + 版本化协议」：
 *
 *   {publicBaseUrl}/{entryPath}/v1/{inviteCode}   （v1，正式格式）
 *   {publicBaseUrl}/{entryPath}/v1/{inviteCode}?t={issueToken}  （渠道二维码，P2）
 *
 * 协议版本（v1）不是应用版本：只有协议废弃、邀请码停用、域名失效
 * 才会使已发行二维码不可用；前端/后端代码升级不应影响历史二维码。
 *
 * ⚠️ 上线提醒：publicBaseUrl 必须使用长期保留的俱乐部公共域名。
 * 本机联调可用 http://localhost:3000（二维码形如 http://localhost:3000/i/v1/{code}），
 * 但生产环境（NODE_ENV=production）sanitize 会拒绝 localhost / 内网 / 私有网段：
 * - 通用二维码自动回退 legacy 裸码格式，不会把不可达地址写入已发行二维码；
 * - 渠道二维码因依赖稳定入口做归因，创建接口会直接拒绝；
 * - 上线前务必把 CLUB_PUBLIC_BASE_URL 换成真实公网域名，否则已印刷物料无法扫码落地。
 *
 * 本模块为纯函数，不依赖 Nest DI；公共域名由调用方（service 层）从
 * ConfigService 读取后传入，未配置时回退为 legacy 裸邀请码。
 */

/** 邀请码二维码图片尺寸。 */
export const STORE_INVITE_QR_CODE_SIZE = 240;

/** 协议版本：v1 = 稳定 URL 格式；legacy = 裸邀请码 / 历史 URL 格式。 */
export const STORE_INVITE_QR_PROTOCOL_V1 = 'v1';
export const STORE_INVITE_QR_PROTOCOL_LEGACY = 'legacy';

export type StoreInviteQrProtocolVersion =
  | typeof STORE_INVITE_QR_PROTOCOL_V1
  | typeof STORE_INVITE_QR_PROTOCOL_LEGACY;

/** 邀请码正则：6~32 位大写字母数字（当前线上为 8 位）。 */
const INVITE_CODE_PATTERN = /^[A-Z0-9]{6,32}$/;

/** 历史 URL query 中可识别邀请码的参数名。 */
const LEGACY_INVITE_CODE_QUERY_KEYS = ['inviteCode', 'code', 'invite_code'];

/** v1 路径式 URL 匹配：{domain}/i/v1/{code} 或 {domain}/invite/v1/{code}。 */
const V1_PATH_PATTERN = /^\/(?:invite|i)\/v1\/([A-Z0-9]{6,32})\/?$/i;

/** 邀请入口路径中的版本段（如 v999），用于识别「版本不支持」。 */
const ENTRY_VERSION_SEGMENT_PATTERN = /^\/(?:invite|i)\/(v\d+)\/(.+?)\/?$/i;

/** 解析结果：识别成功。 */
export type StoreInviteQrRecognizedResult = {
  kind: 'recognized';
  protocolVersion: StoreInviteQrProtocolVersion;
  inviteCode: string;
  /** 渠道二维码的公开 token（URL 中 ?t=xxx），通用二维码为 null */
  issueToken: string | null;
  raw: string;
};

/** 解析结果：命中邀请入口但协议版本未知（如 v999）。 */
export type StoreInviteQrUnsupportedResult = {
  kind: 'unsupported_version';
  protocolVersion: string;
  raw: string;
};

/** 解析结果：无法识别。 */
export type StoreInviteQrUnrecognizedResult = {
  kind: 'unrecognized';
  raw: string;
};

export type StoreInviteQrResolveResult =
  | StoreInviteQrRecognizedResult
  | StoreInviteQrUnsupportedResult
  | StoreInviteQrUnrecognizedResult;

export interface BuildStoreInviteQrPayloadOptions {
  /** 俱乐部公共域名，如 https://club.purelyprofit.com；空字符串时回退 legacy。 */
  baseUrl?: string;
  /** 稳定入口路径前缀，默认 /i。 */
  entryPath?: string;
  /** 渠道二维码的公开 token（可选）：追加为 ?t={token}，用于扫码归因与单张撤销。 */
  issueToken?: string;
  /**
   * 是否放行 localhost / 内网地址（本机联调用）。
   * 默认：生产环境（NODE_ENV=production）禁止，其他环境放行。
   */
  allowPrivateNetwork?: boolean;
}

/**
 * 构建邀请二维码载荷文本。
 *
 * - 未配置公共域名（或域名非法）时回退为裸邀请码（legacy），
 *   保证不会把 localhost / 内网地址写入已发行二维码；
 * - 配置公共域名后生成 v1 稳定 URL；传入 issueToken 时追加 ?t={token}。
 */
export function buildStoreInviteQrPayload(
  inviteCode: string,
  options: BuildStoreInviteQrPayloadOptions = {},
): string {
  const normalizedCode = normalizeInviteCodeCandidate(inviteCode) ?? '';
  if (!normalizedCode) {
    return '';
  }

  const baseUrl = sanitizeBaseUrl(
    options.baseUrl,
    options.allowPrivateNetwork ?? !isProductionEnvironment(),
  );
  if (!baseUrl) {
    return normalizedCode;
  }

  const entryPath = sanitizeEntryPath(options.entryPath);
  const base = `${baseUrl}/${entryPath}/v1/${normalizedCode}`;
  const token =
    typeof options.issueToken === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(options.issueToken)
      ? options.issueToken.trim()
      : '';
  return token ? `${base}?t=${token}` : base;
}

/** 生成二维码 PNG Data URL。 */
export async function buildStoreInviteQrImageDataUrl(
  payload: string,
): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: STORE_INVITE_QR_CODE_SIZE,
    margin: 0,
    type: 'image/png',
  });
}

/**
 * 解析扫码内容，按优先级识别：
 * 1. v1 路径 URL（{domain}/i/v1/{code}）→ recognized(v1)
 * 2. 邀请入口 URL 带未知版本 → unsupported_version
 * 3. 历史 URL query（inviteCode/code/invite_code）→ recognized(legacy)
 * 4. URL 路径末段为合法邀请码 → recognized(legacy)
 * 5. 整串为裸邀请码 → recognized(legacy)
 * 6. 其余 → unrecognized
 */
export function resolveStoreInviteQrPayload(
  scanCode: string,
): StoreInviteQrResolveResult {
  const raw = typeof scanCode === 'string' ? scanCode.trim() : '';
  if (!raw) {
    return { kind: 'unrecognized', raw };
  }

  const directCode = normalizeInviteCodeCandidate(raw);
  if (directCode) {
    return {
      kind: 'recognized',
      protocolVersion: STORE_INVITE_QR_PROTOCOL_LEGACY,
      inviteCode: directCode,
      issueToken: null,
      raw,
    };
  }

  const parsedUrl = tryParseScanCodeUrl(raw);
  if (!parsedUrl) {
    return { kind: 'unrecognized', raw };
  }

  const pathname = parsedUrl.pathname;

  const v1Match = V1_PATH_PATTERN.exec(pathname);
  if (v1Match) {
    const issueToken = normalizeIssueToken(parsedUrl.searchParams.get('t'));
    return {
      kind: 'recognized',
      protocolVersion: STORE_INVITE_QR_PROTOCOL_V1,
      inviteCode: v1Match[1].toUpperCase(),
      issueToken,
      raw,
    };
  }

  const versionSegmentMatch = ENTRY_VERSION_SEGMENT_PATTERN.exec(pathname);
  if (versionSegmentMatch && !/^v1$/i.test(versionSegmentMatch[1])) {
    return {
      kind: 'unsupported_version',
      protocolVersion: versionSegmentMatch[1],
      raw,
    };
  }

  for (const queryKey of LEGACY_INVITE_CODE_QUERY_KEYS) {
    const code = normalizeInviteCodeCandidate(
      parsedUrl.searchParams.get(queryKey),
    );
    if (code) {
      return {
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_LEGACY,
        inviteCode: code,
        issueToken: null,
        raw,
      };
    }
  }

  const lastPathSegment = pathname.split('/').filter(Boolean).at(-1);
  const codeFromPath = normalizeInviteCodeCandidate(lastPathSegment);
  if (codeFromPath) {
    return {
      kind: 'recognized',
      protocolVersion: STORE_INVITE_QR_PROTOCOL_LEGACY,
      inviteCode: codeFromPath,
      issueToken: null,
      raw,
    };
  }

  return { kind: 'unrecognized', raw };
}

function normalizeInviteCodeCandidate(
  value: string | null | undefined,
): string | null {
  const normalizedValue = value?.trim().toUpperCase();
  if (!normalizedValue) {
    return null;
  }
  return INVITE_CODE_PATTERN.test(normalizedValue) ? normalizedValue : null;
}

/** 渠道二维码公开 token 校验：8~64 位字母数字连字符，避免异常内容进入归因逻辑。 */
function normalizeIssueToken(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim();
  if (!normalizedValue || !/^[A-Za-z0-9-]{8,64}$/.test(normalizedValue)) {
    return null;
  }
  return normalizedValue;
}

function tryParseScanCodeUrl(scanCode: string): URL | null {
  try {
    return new URL(scanCode);
  } catch {
    return null;
  }
}

function sanitizeBaseUrl(
  baseUrl: string | undefined,
  allowPrivateNetwork: boolean,
): string {
  if (typeof baseUrl !== 'string') {
    return '';
  }
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(trimmed)) {
    return '';
  }

  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname;
  } catch {
    return '';
  }
  if (!hostname || !isPublicHostname(hostname, allowPrivateNetwork)) {
    return '';
  }
  return trimmed;
}

/**
 * 域名可达性校验。
 *
 * 生产环境严格拒绝 localhost、回环/私有/链路本地/保留网段，
 * 避免把不可达地址写入已发行二维码；
 * 开发 / 测试环境放行本地地址，便于本机联调渠道二维码链路。
 */
function isPublicHostname(hostname: string, allowPrivateNetwork: boolean): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return allowPrivateNetwork;
  }

  // IPv4 地址段检查
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    const parts = normalized.split('.').map(Number);
    if (parts.some((part) => part > 255)) {
      return false;
    }
    const [a, b] = parts;
    const isPrivate =
      a === 10 || // 10.0.0.0/8 私有
      a === 127 || // 127.0.0.0/8 回环
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私有
      (a === 192 && b === 168) || // 192.168.0.0/16 私有
      (a === 169 && b === 254) || // 169.254.0.0/16 链路本地
      (a === 0) || // 0.0.0.0/8
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      a >= 224; // 组播/保留
    return allowPrivateNetwork || !isPrivate;
  }

  // IPv6 本地地址
  if (normalized.includes(':')) {
    const isLocal =
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') || // fc00::/7 唯一本地
      normalized.startsWith('fe80') || // fe80::/10 链路本地
      normalized.startsWith('::ffff:127'); // v4-mapped 回环
    return allowPrivateNetwork || !isLocal;
  }

  // 普通域名
  return true;
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

function sanitizeEntryPath(entryPath: string | undefined): string {
  const trimmed = (typeof entryPath === 'string' ? entryPath : '/i')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return trimmed || 'i';
}
