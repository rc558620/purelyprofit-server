import { SPACE_TOKEN_PATTERN } from '../../purely-profit/operations/scan-qr-payload.utils';

/**
 * 空间码 token 提取（服务端兜底）。
 *
 * 空间码载荷只放不透明 token，业务语义全在服务端查表。已经印出去的码可能有
 * 三种形态，服务端必须都能认：
 *
 *   1. 路径式 URL：`{scanQrBaseUrl}/p/{token}`（现行格式）
 *   2. query 式 URL：`{scanQrBaseUrl}/p?token={token}`
 *   3. 历史自定义协议：`purelyclub://space-scan?token={token}`（未配置域名时的回退格式）
 *
 * 正常链路里前端 `purelyClub/src/utils/scanPayload.ts` 的 `extractSpaceToken`
 * 已经把 URL 还原成裸 token 再上报，服务端根本看不到 URL。但只要有**一个**入口
 * 漏掉提取（未来的 H5 落地页、新版客户端、第三方对接，甚至前端某次改版），
 * 整条 URL 就会被当成 token 去做 `spaceQrCode.token` 的等值匹配 ——
 * 顾客看到「二维码无效，请扫描空间二维码」，而纸上的码其实没坏。
 * 已印刷物料的失效是不可逆的，所以这里做服务端兜底。
 *
 * ⚠️ 幂等性是硬要求：裸 UUID 不含 `/`，不会命中 query / 路径分支，原样返回；
 * 前端「已提取 → 再过一遍服务端」不会把 token 改坏。
 *
 * ⚠️ 形态正则直接复用 `SPACE_TOKEN_PATTERN`（生成侧同一份常量），
 * 命中 token 形态才采用路径末段，避免把路径段 `p` 当成 token。
 */
export function extractSpaceQrToken(rawValue: string): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return '';
  }

  // 形态 2 / 3：query 式 URL 与历史自定义协议都带 `?token=`
  const fromQuery = readTokenQueryParam(value);
  if (fromQuery && SPACE_TOKEN_PATTERN.test(fromQuery)) {
    return fromQuery;
  }

  // 形态 1：路径式 URL，取末段（形态不匹配则不采用，交给下面的裸 token 分支）
  const lastSegment = readLastPathSegment(value);
  if (SPACE_TOKEN_PATTERN.test(lastSegment)) {
    return lastSegment;
  }

  // 裸 token（前端已提取过）：原样返回，保证幂等
  return value;
}

/** 从 `?token=xxx` 中取值；非 URL 或无该参数时返回 null。 */
function readTokenQueryParam(value: string): string | null {
  try {
    const token = new URL(value).searchParams.get('token')?.trim();
    return token || null;
  } catch {
    return null;
  }
}

/** 取路径末段：先剥离 query/hash 与 scheme + host，再取最后一个非空分段。 */
function readLastPathSegment(value: string): string {
  const path = value.split(/[?#]/, 1)[0] ?? '';
  const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const withoutScheme = withoutOrigin.replace(/^[a-z][a-z0-9+.-]*:/i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  return (segments[segments.length - 1] ?? '').trim();
}
