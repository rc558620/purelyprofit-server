/**
 * 二维码公共域名工具。
 *
 * 多条二维码协议共用同一套域名校验规则（门店邀请码 / 扫码点餐桌码 / 空间码），
 * 抽到 shared 层避免各协议各写一份 IP 段判断导致策略漂移。
 *
 * 统一策略：
 * - 未配置或域名非法时返回空串，由调用方回退 legacy 格式，
 *   避免把不可达地址写入已发行二维码；
 * - 生产环境（NODE_ENV=production）严格拒绝 localhost、回环 / 私有 /
 *   链路本地 / 保留网段；
 * - 开发 / 测试环境放行本地地址，便于本机联调。
 */

/**
 * 校验并归一化公共域名。
 *
 * 归一化规则：去首尾空白 + 去掉结尾斜杠；仅接受 `http(s)://host` 形式
 * （不接受带路径的地址，路径由各协议自行拼接，避免出现双重斜杠或路径逃逸）。
 *
 * @param baseUrl 待校验的域名，如 `https://club.purelyprofit.com`
 * @param allowPrivateNetwork 是否放行 localhost / 内网地址
 * @returns 归一化后的域名；不合法时返回空串
 */
export function sanitizePublicBaseUrl(
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
 * 生产环境严格拒绝 localhost、回环 / 私有 / 链路本地 / 保留网段，
 * 避免把不可达地址写入已发行二维码；
 * 开发 / 测试环境放行本地地址，便于本机联调。
 */
export function isPublicHostname(
  hostname: string,
  allowPrivateNetwork: boolean,
): boolean {
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
      a === 0 || // 0.0.0.0/8
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

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 默认是否放行内网地址：仅非生产环境放行。 */
export function resolveAllowPrivateNetwork(override?: boolean): boolean {
  return override ?? !isProductionEnvironment();
}
