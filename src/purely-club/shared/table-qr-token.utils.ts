import { TABLE_TOKEN_PATTERN } from '../../purely-profit/operations/scan-qr-payload.utils';
import {
  readLastPathSegment,
  readTokenQueryParam,
} from './qr-token-parsing.utils';

/**
 * 桌码 token 提取（服务端兜底）。
 *
 * 已经印出去的桌码可能有三种形态，服务端必须都能认：
 *
 *   1. query 式 URL：`{scanQrBaseUrl}/t?token={token}`
 *   2. 路径式 URL：`{scanQrBaseUrl}/t/{token}`（现行格式）
 *   3. 历史裸 token：`{token}`（未配置扫码域名时的回退格式）
 *
 * 正常链路里前端 `purelyClub/src/utils/scanPayload.ts` 的 `extractTableToken`
 * 已经把 URL 还原成裸 token 再上报，服务端根本看不到 URL。但只要有**一个**入口
 * 漏掉提取（未来的 H5 落地页、新版客户端、第三方对接，甚至前端某次改版），
 * 整条 URL 就会被拿去做 `tokenHash` 的 sha256 匹配 ——
 * 顾客看到「桌码无效，请重新扫码」，而纸上的码其实没坏。
 * 已印刷物料的失效是不可逆的，所以这里做服务端兜底。
 *
 * ⚠️ 幂等性是硬要求：裸 token 不含 `/`，不会命中 query / 路径分支，原样返回；
 * 前端「已提取 → 再过一遍服务端」不会把 token 改坏。
 *
 * ⚠️ 形态正则直接复用生成侧的 `TABLE_TOKEN_PATTERN`，命中 token 形态才采用
 * 路径末段，避免把路径段 `t` 当成 token。
 */
export function extractTableQrToken(rawValue: string): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return '';
  }

  // 形态 1：query 式 URL
  const fromQuery = readTokenQueryParam(value);
  if (fromQuery) {
    return fromQuery;
  }

  // 形态 2：路径式 URL（命中 token 形态才采用，避免把 `t` 当 token）
  const lastSegment = readLastPathSegment(value);
  if (TABLE_TOKEN_PATTERN.test(lastSegment)) {
    return lastSegment;
  }

  // 形态 3：历史裸 token（前端已提取过）
  return value;
}
