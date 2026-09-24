import { InternalServerErrorException, Logger } from '@nestjs/common';
import QRCode from 'qrcode';
import {
  resolveAllowPrivateNetwork,
  sanitizePublicBaseUrl,
} from '../../shared/qr-public-url.utils';

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
 * 本模块不依赖 Nest DI（只用 Logger 打点、抛标准 HttpException）；公共域名由调用方
 * （service 层）从 ConfigService 读取后传入，未配置时回退为 legacy 裸邀请码。
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

/**
 * 进店码入口路径段白名单（`{base}/{entrySegment}/v1/{code}` 中的 `{entrySegment}`）。
 *
 * ⚠️ 必须与前端 `purelyClub/src/utils/scanPayload.ts` 的 `SCAN_PATH_KINDS.storeInvite`
 * 与 `STORE_INVITE_SEGMENTS` 保持一致，跨仓由 `npm run scan:qr:contract:check` 守住。
 *
 * 为什么必须收成具名常量 + 白名单：入口段是 env 可配项
 * （`club.storeInviteQrEntryPath` / `CLUB_STORE_INVITE_QR_ENTRY_PATH`，默认 `/i`），
 * 改动不需要过 review。运维随手填 `/join` 时，生成侧会产出 `/join/v1/CODE`，
 * 而服务端 `V1_PATH_PATTERN` 与前端分类只认白名单内的段 —— 已印刷物料会
 * **静默失效且无任何报错**，只能等顾客扫不出来才发现。桌码 / 空间码的路径段是
 * 代码常量，这里是配置，因此必须显式拒绝白名单外的取值。
 */
export const STORE_INVITE_QR_ENTRY_SEGMENTS = ['i', 'invite'] as const;

/** 入口段取值类型。 */
export type StoreInviteQrEntrySegment =
  (typeof STORE_INVITE_QR_ENTRY_SEGMENTS)[number];

/** 默认入口段：未配置或配置非法时使用（与历史已印刷物料一致）。 */
export const STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT: StoreInviteQrEntrySegment =
  'i';

/** 由白名单派生的正则片段，保证生成侧与解析侧永远同源。 */
const ENTRY_SEGMENTS_PATTERN_SOURCE = STORE_INVITE_QR_ENTRY_SEGMENTS.join('|');

/** v1 路径式 URL 匹配：{domain}/i/v1/{code} 或 {domain}/invite/v1/{code}。 */
const V1_PATH_PATTERN = new RegExp(
  `^/(?:${ENTRY_SEGMENTS_PATTERN_SOURCE})/v1/([A-Z0-9]{6,32})/?$`,
  'i',
);

/** 邀请入口路径中的版本段（如 v999），用于识别「版本不支持」。 */
const ENTRY_VERSION_SEGMENT_PATTERN = new RegExp(
  `^/(?:${ENTRY_SEGMENTS_PATTERN_SOURCE})/(v\\d+)/(.+?)/?$`,
  'i',
);

/**
 * 入口段非法告警按「取值」去重：非法配置会在每次出图时命中，
 * 不去重会把启动后的日志刷满（与 `reportScanQrBaseUrlStatus` 同一套思路）。
 */
const reportedInvalidEntryPaths = new Set<string>();
const entryPathLogger = new Logger('StoreInviteQrPayload');

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
 * - 配置公共域名后生成 v1 稳定 URL；传入 issueToken 时追加 ?t={token}；
 * - 入口路径段必须是 `STORE_INVITE_QR_ENTRY_SEGMENTS` 白名单内的取值，
 *   否则回退默认段并记 error（理由见该常量注释）。
 */
export function buildStoreInviteQrPayload(
  inviteCode: string,
  options: BuildStoreInviteQrPayloadOptions = {},
): string {
  const normalizedCode = normalizeInviteCodeCandidate(inviteCode) ?? '';
  if (!normalizedCode) {
    return '';
  }

  const baseUrl = sanitizePublicBaseUrl(
    options.baseUrl,
    resolveAllowPrivateNetwork(options.allowPrivateNetwork),
  );
  if (!baseUrl) {
    return normalizedCode;
  }

  const entryPath = sanitizeEntryPath(options.entryPath);
  const base = `${baseUrl}/${entryPath}/v1/${normalizedCode}`;
  const token =
    typeof options.issueToken === 'string' &&
    /^[A-Za-z0-9-]{8,64}$/.test(options.issueToken)
      ? options.issueToken.trim()
      : '';
  return token ? `${base}?t=${token}` : base;
}

/**
 * 出图前置校验：空载荷必须拦住，不能交给 qrcode。
 *
 * `buildStoreInviteQrPayload` 在邀请码形态非法（如历史脏数据、大小写与长度异常）
 * 时返回空串；直接出图会让 `qrcode.toDataURL('')` 抛 `No input text` → 接口 500，
 * 商家端只看到「服务器错误」而不知道要重新轮换。更要紧的是：调用方常用
 * `payload !== inviteCode` 判断协议版本，空载荷会被先误判成 v1。
 *
 * 因此统一在这里拦成显式异常（照搬空间码 `buildQrContent()` 的处理）。
 */
export function assertUsableStoreInviteQrPayload(payload: string): string {
  if (!payload) {
    throw new InternalServerErrorException(
      '进店码内容生成失败，请重新轮换邀请码',
    );
  }
  return payload;
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

/**
 * 归一化入口路径段：只接受白名单取值，其余一律回退默认段。
 *
 * 历史实现是「原样接受任意值」，于是 env 填 `/join` 会静默产出解析侧不认的 URL；
 * 这里改为显式拒绝 + error 告警，保证「已印刷物料的入口段」永远落在生成侧与
 * 解析侧都认的那几个值上。
 */
function sanitizeEntryPath(entryPath: string | undefined): string {
  if (typeof entryPath !== 'string') {
    return STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT;
  }

  const trimmed = entryPath.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT;
  }

  const matchedSegment = STORE_INVITE_QR_ENTRY_SEGMENTS.find(
    (segment) => segment.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!matchedSegment) {
    reportInvalidEntryPath(trimmed);
    return STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT;
  }
  return matchedSegment;
}

/** 入口段不在白名单内：记 error（按取值去重），避免运维以为配置已生效。 */
function reportInvalidEntryPath(rawEntryPath: string): void {
  if (reportedInvalidEntryPaths.has(rawEntryPath)) {
    return;
  }
  reportedInvalidEntryPaths.add(rawEntryPath);
  entryPathLogger.error(
    `club.storeInviteQrEntryPath="${rawEntryPath}" 不在白名单 ` +
      `（${STORE_INVITE_QR_ENTRY_SEGMENTS.join(' / ')}）内，已回退为 ` +
      `"${STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT}"。` +
      '生成侧与解析侧只认白名单入口段，该配置改坏会让已印刷物料静默失效',
  );
}
