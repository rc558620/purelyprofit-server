import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresProfileService } from './stores-profile.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/** 门店 Logo 代理结果。 */
export interface StoreLogoProxyResult {
  /** 图片 MIME 类型（已去掉 charset 等参数）。 */
  contentType: string;
  /** 图片二进制。 */
  buffer: Buffer;
}

/** 拉取超时（毫秒）：Logo 是小图，超时直接失败，不拖慢海报合成。 */
const FETCH_TIMEOUT_MS = 5_000;
/** 单张 Logo 大小上限（字节）。 */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
/** 响应缓存时长（秒）：Logo 变更频率低，短缓存即可。 */
export const STORE_LOGO_CACHE_MAX_AGE_SECONDS = 300;

/**
 * 判断是否应被阻断的主机：只放行公网地址。
 *
 * 门店 Logo 是可由门店自行写入的 URL 字段，代理时必须防 SSRF ——
 * 否则内网地址会被本接口带出去。
 */
export const isBlockedLogoHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.internal') || host.endsWith('.local')) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
  }
  return false;
};

/**
 * 门店 Logo 同源代理服务。
 *
 * 存在意义：对象存储（腾讯云 COS）默认不返回 CORS 头，前端要么
 * crossOrigin 加载失败、要么不声明而污染画布导致无法导出 PNG ——
 * 两种结果都是桌码海报只能回退品牌图标。经本服务代理后，前端拿到的是
 * 同源资源，可安全参与 Canvas 合成与导出。
 */
@Injectable()
export class StoreLogoProxyService {
  private readonly logger = new Logger(StoreLogoProxyService.name);

  constructor(
    private readonly profileService: StoresProfileService,
    private readonly configService: ConfigService,
  ) {}

  /** 读取当前门店 Logo 并以同源二进制返回。 */
  async getStoreLogo(user: AuthenticatedUser): Promise<StoreLogoProxyResult> {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) throw new NotFoundException('当前账号未绑定门店');

    const metadata =
      await this.profileService.readStoreProfileMetadata(storeId);
    const logoUrl = metadata.storeLogo?.trim();
    if (!logoUrl) throw new NotFoundException('门店未上传 Logo');

    this.assertHostAllowed(logoUrl);

    let response: Response;
    try {
      response = await fetch(logoUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // 不接受跳转：跳转可能绕开上面的主机校验
        redirect: 'manual',
        headers: { accept: 'image/*' },
      });
    } catch (error) {
      this.logger.warn(`门店 Logo 拉取失败：${this.toMessage(error)}`);
      throw new BadGatewayException('门店 Logo 拉取失败');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new BadGatewayException('门店 Logo 地址存在跳转，已拒绝代理');
    }
    if (!response.ok) {
      throw new BadGatewayException('门店 Logo 拉取失败');
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new BadGatewayException('门店 Logo 不是图片资源');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_LOGO_BYTES) {
      throw new BadGatewayException('门店 Logo 体积超出上限');
    }

    return { contentType, buffer };
  }

  /** 校验 Logo 地址协议与主机，防 SSRF。 */
  private assertHostAllowed(logoUrl: string): void {
    let url: URL;
    try {
      url = new URL(logoUrl);
    } catch {
      throw new BadGatewayException('门店 Logo 地址非法');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadGatewayException('门店 Logo 地址协议不支持');
    }
    if (isBlockedLogoHost(url.hostname)) {
      throw new BadGatewayException('门店 Logo 地址不可访问');
    }
    const allowedHosts = (
      this.configService.get<string>('stores.logoProxyAllowedHosts') ?? ''
    )
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== '');
    if (
      allowedHosts.length > 0 &&
      !allowedHosts.includes(url.hostname.toLowerCase())
    ) {
      throw new BadGatewayException('门店 Logo 域名不在允许列表');
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
