import { BadGatewayException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  isBlockedLogoHost,
  StoreLogoProxyService,
} from './store-logo-proxy.service';
import type { StoresProfileService } from './stores-profile.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

describe('isBlockedLogoHost', () => {
  it('阻断本机与内网地址（防 SSRF）', () => {
    const blocked = [
      'localhost',
      'a.localhost',
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'db.internal',
      'printer.local',
    ];
    blocked.forEach((host) => {
      expect(isBlockedLogoHost(host)).toBe(true);
    });
  });

  it('放行公网域名', () => {
    expect(
      isBlockedLogoHost('f0rest2012-1454036968.cos.ap-guangzhou.myqcloud.com'),
    ).toBe(false);
    expect(isBlockedLogoHost('cdn.example.com')).toBe(false);
  });
});

describe('StoreLogoProxyService', () => {
  const user = {
    currentMembership: { storeId: 37 },
  } as unknown as AuthenticatedUser;

  const buildService = (
    metadata: { storeLogo?: string },
    allowedHosts = '',
  ) => {
    const profileService = {
      readStoreProfileMetadata: jest.fn().mockResolvedValue(metadata),
    } as unknown as StoresProfileService;
    const configService = {
      get: jest.fn().mockReturnValue(allowedHosts),
    } as unknown as ConfigService;
    return new StoreLogoProxyService(profileService, configService);
  };

  const stubFetch = (options: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    bytes?: number;
  }) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: options.ok ?? true,
      status: options.status ?? 200,
      headers: { get: () => options.contentType ?? 'image/jpeg' },
      arrayBuffer: () =>
        Promise.resolve(new Uint8Array(options.bytes ?? 8).buffer),
    }) as unknown as typeof fetch;
  };

  it('未绑定门店时抛 404', async () => {
    await expect(
      buildService({}).getStoreLogo({} as AuthenticatedUser),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('门店未上传 Logo 时抛 404', async () => {
    await expect(buildService({}).getStoreLogo(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('正常返回图片类型与二进制', async () => {
    stubFetch({ contentType: 'image/jpeg', bytes: 16 });
    const service = buildService({
      storeLogo: 'https://cdn.example.com/logo.jpg',
    });

    const result = await service.getStoreLogo(user);

    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer.byteLength).toBe(16);
  });

  it('content-type 非图片时抛 502', async () => {
    stubFetch({ contentType: 'text/html' });
    const service = buildService({ storeLogo: 'https://cdn.example.com/a' });
    await expect(service.getStoreLogo(user)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('内网地址直接拒绝，不发起请求', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const service = buildService({ storeLogo: 'http://127.0.0.1/logo.png' });

    await expect(service.getStoreLogo(user)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('配置了域名白名单时拦截非白名单域名', async () => {
    stubFetch({});
    const service = buildService(
      { storeLogo: 'https://cdn.example.com/logo.png' },
      'other.example.com',
    );
    await expect(service.getStoreLogo(user)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('3xx 跳转响应被拒绝（避免绕过主机校验）', async () => {
    stubFetch({ ok: false, status: 302 });
    const service = buildService({ storeLogo: 'https://cdn.example.com/logo' });
    await expect(service.getStoreLogo(user)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('拉取异常时抛 502', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const service = buildService({ storeLogo: 'https://cdn.example.com/logo' });
    await expect(service.getStoreLogo(user)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
