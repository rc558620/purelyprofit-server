/**
 * 扫码二维码 token 的通用解析原语（桌码 / 空间码共用）。
 *
 * 桌码与空间码的载荷形态不同（base64url 长串 vs UUID），但「从 URL 里把 token
 * 取出来」这一步完全一样，各自实现一份会让两侧的容错行为悄悄漂移：
 * 例如一侧认 `?token=`、另一侧不认，已印刷物料就只在一半入口可扫。
 * 形态判定（命中哪个正则）仍然由各自的 `extract*QrToken` 负责，这里只取片段。
 */

/** 从 `?token=xxx` 中取值；非 URL 或无该参数时返回 null。 */
export function readTokenQueryParam(value: string): string | null {
  try {
    const token = new URL(value).searchParams.get('token')?.trim();
    return token || null;
  } catch {
    return null;
  }
}

/** 取路径末段：先剥离 query/hash 与 scheme + host，再取最后一个非空分段。 */
export function readLastPathSegment(value: string): string {
  const path = value.split(/[?#]/, 1)[0] ?? '';
  const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const withoutScheme = withoutOrigin.replace(/^[a-z][a-z0-9+.-]*:/i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  return (segments[segments.length - 1] ?? '').trim();
}
